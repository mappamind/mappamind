// Channel adjudication prompt (plan Phase 3 — the recognition layer).
//
// The model is the ONLY place channel recognition lives (no catchers in our code,
// §I1). It is handed a bounded set of deterministically-surfaced CANDIDATES — real
// strings really shared across services — and asked, per candidate: is this a real
// cross-service channel? what kind? and for each cited site, does that service
// PRODUCE or CONSUME it? It may ONLY reference the endpoints it was given (by index)
// — it cannot invent a file, a line, or a string (§I2). Everything it emits is an
// untrusted proposal; the deterministic verifier (Phase 4) re-finds the anchors and
// is the only writer of an edge.

import type { ChannelCandidate } from "@mappamind_/seam";

export const CHANNEL_SYSTEM = [
  "You decide whether shared strings across services are real cross-service CHANNELS.",
  "A channel is a runtime conduit between services: an HTTP route, a queue/topic, an",
  "RPC method, an event name, a shared data key, or a DI token. This is recognition",
  "that generalizes to ANY framework — judge by what the code does, not by tokens.",
  "",
  "You are given CANDIDATES. Each candidate is one normalized key plus a numbered list",
  "of ENDPOINTS — the exact sites (service, file:line, cited text, surrounding code)",
  "where that key appears. For each candidate decide:",
  "  - isChannel: do these sites genuinely wire services together at runtime? A string",
  "    that coincidentally matches (a log line, a comment, a CSS path, a MIME type, an",
  "    unrelated constant) is NOT a channel — set isChannel=false.",
  "  - kind: one of http | queue | rpc | event | data | di | unknown.",
  "  - memberships: for EACH endpoint that is really part of the channel, its role:",
  "      produce  — this service DECLARES/serves it (route handler, queue subscriber,",
  "                 RPC method definition, event publisher's registration).",
  "      consume  — this service CALLS/uses it (builds the URL, publishes the message).",
  "      both     — it does both.  (Omit an endpoint entirely if it is NEITHER.)",
  "  - For each membership, confidence: probable | possible (you may NOT say verified —",
  "    a separate deterministic step verifies existence).",
  "",
  "Rules, non-negotiable:",
  "- Reference endpoints ONLY by the integer index given. Never invent a file/line/text.",
  "- A real channel needs producing/consuming endpoints in >=2 DIFFERENT services.",
  "- Direction comes from roles: consumers call producers. If you cannot tell who",
  "  produces vs consumes, mark roles you are sure of and drop the rest.",
  "- When unsure a candidate is a channel at all, set isChannel=false. Miss over invent.",
  "Output STRICT JSON only, no prose, matching exactly:",
  '{ "channels": [ { "id": str, "isChannel": bool, "kind": str, "rationale": str,',
  '    "memberships": [ { "endpoint": int, "role": str, "confidence": str } ] } ] }'
].join("\n");

export type PromptEndpoint = {
  readonly index: number;
  readonly service: string;
  readonly location: string; // file:line
  readonly text: string;
  readonly context?: string; // a few surrounding source lines, if available
};

export type PromptCandidate = {
  readonly id: string;
  readonly key: string;
  readonly endpoints: readonly PromptEndpoint[];
};

function renderEndpoint(e: PromptEndpoint): string {
  const head = `    [${e.index}] ${e.service}  ${e.location}  "${e.text}"`;
  if (!e.context) return head;
  const indented = e.context
    .split("\n")
    .map((line) => `        ${line}`)
    .join("\n");
  return `${head}\n${indented}`;
}

export function buildChannelPrompt(candidates: readonly PromptCandidate[]): string {
  const blocks = candidates.map((c) => {
    const lines = [`CANDIDATE ${c.id}  key="${c.key}"  endpoints:`];
    for (const e of c.endpoints) lines.push(renderEndpoint(e));
    return lines.join("\n");
  });
  return [
    `Adjudicate ${candidates.length} candidate channel(s). For each, decide isChannel, kind,`,
    "and the role of each endpoint. Reference endpoints only by their [index].",
    "",
    blocks.join("\n\n"),
    "",
    "Return the STRICT JSON described in the system message."
  ].join("\n");
}

// Red-team second pass (plan Phase 3, optional): give the model the channels that
// survived and ask for the STRONGEST reason each is NOT real. Disagreement demotes
// or drops — cheap insurance against plausible-but-wrong relations the verifier
// (existence only) cannot catch.
export const CHANNEL_REDTEAM_SYSTEM = [
  "You are a skeptic. For each channel claim below, give the strongest reason it is",
  "NOT a real cross-service runtime channel. Then verdict: keep | demote | drop.",
  "  keep   — the claim is a real runtime call between services.",
  "  demote — plausible but the evidence is weak; lower its confidence.",
  "  drop   — it is not a real runtime channel.",
  "DROP these decisively (they are the common false positives):",
  "  - the 'produce' side is a TYPE DECLARATION (.d.ts), generated stub, DTO, schema,",
  "    or interface — a type is not a runtime producer; the string only co-occurs",
  "    because both sides import the same generated types.",
  "  - the 'produce' side is a SHARED LIBRARY / types PACKAGE (e.g. a packages/* or",
  "    node_modules dep many apps import) — that is compile-time coupling, not a channel.",
  "  - coincidental string (a log line, constant, CSS/asset path, MIME type), dead/test code,",
  "    or same-service self-reference.",
  "A real channel is asymmetric: one side DECLARES/serves it (a route handler, queue",
  "subscriber, RPC method), the other CONSUMES it (builds the URL, publishes). If neither",
  "side is a genuine runtime endpoint, drop it.",
  "Default to demote/drop when uncertain. Output STRICT JSON only:",
  '{ "verdicts": [ { "id": str, "verdict": str, "reason": str } ] }'
].join("\n");

export function buildRedTeamPrompt(
  items: readonly { id: string; key: string; kind: string; rationale: string; evidence: string }[]
): string {
  const blocks = items.map((i) => `CLAIM ${i.id}  key="${i.key}"  kind=${i.kind}  ${i.evidence}  why="${i.rationale}"`);
  return [
    "Challenge each channel claim. The evidence shows the produce-side and consume-side",
    "service:file — use it: a .d.ts / shared-package producer is the tell-tale false positive.",
    "For each claim output a verdict keep|demote|drop with a reason.",
    "",
    blocks.join("\n"),
    "",
    "Return the STRICT JSON described in the system message."
  ].join("\n");
}

// Cap a candidate's prompt footprint without dropping any candidate (ubiquity is a
// ranking signal, never a filter): a hub with many endpoints keeps all of them, but
// each context excerpt stays small. Re-exported for the adjudicator.
export function candidateToPrompt(
  candidate: ChannelCandidate,
  id: string,
  contextFor?: (index: number) => string | undefined
): PromptCandidate {
  return {
    id,
    key: candidate.key,
    endpoints: candidate.endpoints.map((e, index) => {
      const context = contextFor?.(index);
      return {
        index,
        service: e.service,
        location: `${e.file}:${e.line}`,
        text: e.text,
        ...(context ? { context } : {})
      };
    })
  };
}
