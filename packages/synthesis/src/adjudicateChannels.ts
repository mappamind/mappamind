// Channel adjudication orchestrator (plan Phase 3).
//
// Turns deterministically-surfaced candidates into PROPOSED channel claims by asking
// the model, per candidate, which endpoints produce/consume and what kind. The model
// only ever SELECTS from the endpoints it was given (by index) — it cannot invent a
// file/line/text (§I2). Output is untrusted: the verifier (Phase 4) re-finds every
// cited anchor and is the sole writer of an edge. Cost is O(candidates), batched, and
// diff-scoped at the accept moment — never O(repo).

import type { Channel, ChannelCandidate, ChannelKind, ChannelMembership, EndpointRole } from "@mappamind_/seam";

import {
  CHANNEL_REDTEAM_SYSTEM,
  CHANNEL_SYSTEM,
  buildChannelPrompt,
  buildRedTeamPrompt,
  candidateToPrompt
} from "./channelPrompt.js";
import type { ModelCallLog, ModelClient } from "./model.js";
import { extractJsonObject } from "./parse.js";

export type AdjudicateInput = {
  readonly candidates: readonly ChannelCandidate[];
  readonly client: ModelClient;
  // Full source text per file path, used to give the model a few lines of context
  // around each anchor. Optional — without it the anchor text alone is shown.
  readonly sources?: ReadonlyMap<string, string>;
  readonly batchSize?: number; // candidates per model call (cost bound)
  readonly concurrency?: number; // batches in flight at once (default 6) — wall-clock bound
  readonly redTeam?: boolean; // run the skeptic second pass
  // The agent's session transcript (plan Phase 7). UNTRUSTED: it points the model
  // at what the session touched (candidates it mentions are adjudicated first, and
  // it is shown as a hint), but a claim still dies if the verifier can't re-find its
  // anchors. Verification is easier than discovery — the hint says where to look.
  readonly transcript?: string;
};

export type AdjudicationResult = {
  readonly channels: readonly Channel[];
  readonly calls: readonly ModelCallLog[];
};

const KINDS = new Set<ChannelKind>(["http", "queue", "rpc", "event", "data", "di", "unknown"]);
const ROLES = new Set<EndpointRole>(["produce", "consume", "both"]); // "unknown"/"neither" memberships are dropped

function asKind(value: unknown): ChannelKind {
  return typeof value === "string" && KINDS.has(value as ChannelKind) ? (value as ChannelKind) : "unknown";
}

function asConfidence(value: unknown): ChannelMembership["confidence"] {
  // The model may NOT self-certify "verified" — that's the verifier's job (§I3).
  return value === "possible" ? "possible" : "probable";
}

function contextLines(source: string | undefined, line: number, radius = 3): string | undefined {
  if (!source) return undefined;
  const lines = source.split("\n");
  const start = Math.max(0, line - 1 - radius);
  const end = Math.min(lines.length, line + radius);
  if (start >= end) return undefined;
  return lines
    .slice(start, end)
    .map((text, i) => `${start + i + 1}| ${text}`)
    .join("\n");
}

type RawMembership = { endpoint: number; role: string; confidence: unknown };
type RawChannel = { id: string; isChannel: boolean; kind: unknown; rationale: string; memberships: RawMembership[] };

function parseAdjudication(text: string): RawChannel[] {
  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  if (!Array.isArray(parsed["channels"])) return [];
  const out: RawChannel[] = [];
  for (const raw of parsed["channels"]) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? (r["id"] as string) : undefined;
    if (!id) continue;
    const memberships = Array.isArray(r["memberships"])
      ? (r["memberships"]
          .map((m): RawMembership | null => {
            if (typeof m !== "object" || m === null) return null;
            const mr = m as Record<string, unknown>;
            if (typeof mr["endpoint"] !== "number" || typeof mr["role"] !== "string") return null;
            return { endpoint: mr["endpoint"], role: mr["role"], confidence: mr["confidence"] };
          })
          .filter((m): m is RawMembership => m !== null))
      : [];
    out.push({
      id,
      isChannel: r["isChannel"] === true,
      kind: r["kind"],
      rationale: typeof r["rationale"] === "string" ? (r["rationale"] as string) : "",
      memberships
    });
  }
  return out;
}

// Build a Channel from one raw verdict, keeping only memberships that cite a real
// endpoint index with a real role. Drops the channel if it doesn't span >=2 services.
function toChannel(raw: RawChannel, candidate: ChannelCandidate): Channel | null {
  if (!raw.isChannel) return null;
  const memberships: ChannelMembership[] = [];
  const seen = new Set<string>();
  for (const m of raw.memberships) {
    if (!ROLES.has(m.role as EndpointRole)) continue; // drops "neither"/"unknown"
    const anchor = candidate.endpoints[m.endpoint];
    if (!anchor) continue; // model cited an index that doesn't exist — refuse it
    const key = `${anchor.service} ${anchor.file} ${anchor.line} ${m.role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    memberships.push({ service: anchor.service, role: m.role as EndpointRole, anchor, confidence: asConfidence(m.confidence) });
  }
  const services = new Set(memberships.map((m) => m.service));
  if (services.size < 2) return null;
  return { key: candidate.key, kind: asKind(raw.kind), memberships, rationale: raw.rationale };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const MAX_TRANSCRIPT_CHARS = 4000;

// Untrusted hint block: the agent's own account of what it changed. It focuses the
// model, never authorizes — the verifier still re-finds every anchor (§I2/I3).
function transcriptHint(transcript: string): string {
  const excerpt =
    transcript.length > MAX_TRANSCRIPT_CHARS ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)} …(truncated)` : transcript;
  return [
    "AGENT SESSION HINT (UNTRUSTED — the agent described what it changed; use it to",
    "focus your judgment, but every claim is still checked against the endpoints below):",
    excerpt
  ].join("\n");
}

// Bias adjudication toward what the session touched: candidates whose key or cited
// text appears in the transcript are adjudicated first (the recall backstop, plan
// go-condition #3). Stable partition — order is otherwise preserved.
export function rankByTranscript(
  candidates: readonly ChannelCandidate[],
  transcript: string
): ChannelCandidate[] {
  const t = transcript.toLowerCase();
  const mentioned = (c: ChannelCandidate): boolean =>
    t.includes(c.key.toLowerCase()) || c.endpoints.some((e) => e.text.length > 0 && t.includes(e.text.toLowerCase()));
  const yes: ChannelCandidate[] = [];
  const no: ChannelCandidate[] = [];
  for (const c of candidates) (mentioned(c) ? yes : no).push(c);
  return [...yes, ...no];
}

// Run async tasks with a bounded number in flight. Each `claude -p` is a fresh CLI
// spawn (~minute), so a flood of 500+ candidates run sequentially takes ~an hour;
// a small concurrency cap cuts that ~N× while staying gentle on the host (plan I7:
// never block). Results are kept in input order so the run stays deterministic.
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function adjudicateChannels(input: AdjudicateInput): Promise<AdjudicationResult> {
  const batchSize = input.batchSize ?? 12;
  const concurrency = Math.max(1, input.concurrency ?? 6);

  // Transcript-as-input (Phase 7): focus on what the session touched, first.
  const ordered = input.transcript ? rankByTranscript(input.candidates, input.transcript) : input.candidates;
  const hint = input.transcript ? `${transcriptHint(input.transcript)}\n\n` : "";
  const batches = chunk(ordered, batchSize);

  // One batch → one model call → its surviving channels + the call log. A failed or
  // unparseable batch yields nothing (never a fabrication), exactly as before.
  const processBatch = async (batch: ChannelCandidate[], b: number): Promise<{ channels: Channel[]; calls: ModelCallLog[] }> => {
    const byId = new Map<string, ChannelCandidate>();
    const promptCandidates = batch.map((candidate, i) => {
      const id = `c${b}_${i}`;
      byId.set(id, candidate);
      return candidateToPrompt(candidate, id, (index) => {
        const ep = candidate.endpoints[index]!;
        return contextLines(input.sources?.get(ep.file), ep.line);
      });
    });
    const prompt = hint + buildChannelPrompt(promptCandidates);
    let responseText: string;
    try {
      const response = await input.client.complete({ system: CHANNEL_SYSTEM, prompt });
      responseText = response.text;
    } catch {
      return { channels: [], calls: [] };
    }
    const calls: ModelCallLog[] = [{ label: `adjudicate-channels:batch-${b}`, system: CHANNEL_SYSTEM, prompt, response: responseText }];
    let verdicts: RawChannel[];
    try {
      verdicts = parseAdjudication(responseText);
    } catch {
      return { channels: [], calls };
    }
    const channels: Channel[] = [];
    for (const v of verdicts) {
      const candidate = byId.get(v.id);
      if (!candidate) continue; // model invented an id
      const channel = toChannel(v, candidate);
      if (channel) channels.push(channel);
    }
    return { channels, calls };
  };

  const perBatch = await mapWithConcurrency(batches, concurrency, processBatch);
  const channels = perBatch.flatMap((r) => r.channels);
  const calls = perBatch.flatMap((r) => r.calls);

  if (!input.redTeam || channels.length === 0) return { channels, calls };
  return redTeam(channels, input.client, calls);
}

// Skeptic pass: demote/drop channels the model itself can't defend. Demote lowers
// every membership to "possible"; drop removes the channel.
// One-line evidence per claim: the produce-side and consume-side service:file, so
// the skeptic can see a .d.ts / shared-package "producer" — the tell-tale false edge.
function redTeamEvidence(channel: Channel): string {
  const p = channel.memberships.find((m) => m.role === "produce" || m.role === "both");
  const c = channel.memberships.find((m) => m.role === "consume" || m.role === "both");
  const producers = new Set(channel.memberships.filter((m) => m.role === "produce" || m.role === "both").map((m) => m.service));
  const consumers = new Set(channel.memberships.filter((m) => m.role === "consume" || m.role === "both").map((m) => m.service));
  return (
    `produce=${p ? `${p.service}:${p.anchor.file}` : "?"} consume=${c ? `${c.service}:${c.anchor.file}` : "?"}` +
    ` fanin=${consumers.size}->${producers.size}`
  );
}

async function redTeam(
  channels: readonly Channel[],
  client: ModelClient,
  calls: ModelCallLog[]
): Promise<AdjudicationResult> {
  const items = channels.map((c, i) => ({ id: `r${i}`, key: c.key, kind: c.kind, rationale: c.rationale, evidence: redTeamEvidence(c) }));
  // Batch like adjudication: 213 claims in one prompt is unreliable. Each batch is
  // one skeptic call; results merge into a single verdict map.
  const batches = chunk(items, 25);
  const verdicts = new Map<string, string>();
  const perBatch = await mapWithConcurrency(batches, 6, async (batch, b) => {
    const prompt = buildRedTeamPrompt(batch);
    try {
      const response = await client.complete({ system: CHANNEL_REDTEAM_SYSTEM, prompt });
      return { log: { label: `adjudicate-channels:red-team-${b}`, system: CHANNEL_REDTEAM_SYSTEM, prompt, response: response.text }, text: response.text };
    } catch {
      return null;
    }
  });
  for (const r of perBatch) {
    if (!r) continue;
    calls.push(r.log);
    try {
      const parsed = JSON.parse(extractJsonObject(r.text)) as Record<string, unknown>;
      if (Array.isArray(parsed["verdicts"])) {
        for (const raw of parsed["verdicts"]) {
          if (typeof raw !== "object" || raw === null) continue;
          const rec = raw as Record<string, unknown>;
          if (typeof rec["id"] === "string" && typeof rec["verdict"] === "string") verdicts.set(rec["id"], rec["verdict"]);
        }
      }
    } catch {
      // a batch whose JSON won't parse leaves its claims at the default "keep"
    }
  }

  const kept: Channel[] = [];
  channels.forEach((channel, i) => {
    const verdict = verdicts.get(`r${i}`) ?? "keep";
    if (verdict === "drop") return;
    if (verdict === "demote") {
      kept.push({ ...channel, memberships: channel.memberships.map((m) => ({ ...m, confidence: "possible" })) });
      return;
    }
    kept.push(channel);
  });
  return { channels: kept, calls };
}
