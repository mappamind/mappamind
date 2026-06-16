// The deterministic verifier (plan Phase 4) — THE trust boundary.
//
// The model proposes channels; nothing it says is admitted until this re-finds the
// cited anchors in the current facts. The verifier — not the model — writes the edge
// (§I2). It confirms EXISTENCE only (the cited string is really at the cited file);
// it does NOT bless direction/kind, which stay model-inferred and are shown as such
// (§I3). It runs PER MEMBERSHIP (§11.1): cost & determinism are O(memberships).
//
// Plus one DETERMINISTIC role gate (§I4, the role-complementarity rule): a PRODUCER
// must be backed by runtime behaviour — the side that actually serves the channel.
// A declaration-only file (only type declarations, no calls and no function/method
// bodies: a `.d.ts`, a `.pyi`, a generated types package, a bare DTO/constants file)
// can NAME a route but can never SERVE one, so its anchor cannot be a producer. This
// is language-structural like the import-exclusion rule — computed from normalized
// facts, true in every repo — NOT a framework catcher. It collapses shared-types
// over-production completely and consistently, where a model red-team pass alone is
// inconsistent.
//
// Determinism (§I5): a channel's identity and its evidence are content-hashed, so an
// unchanged candidate reuses its cached adjudication verbatim — no model call, no
// churn. Identical code ⇒ identical verified set.

import { anchorHash, channelClaimId, sha256 } from "@mappamind_/core";
import type { FileFacts } from "@mappamind_/extractors";

import type { Channel, ChannelCandidate, ChannelEdgeView, ChannelMembership } from "./channel.js";
import { isContractFile } from "./contractAnchors.js";

// What the verifier needs to know about one file: every string anchor text present in
// it (the re-find test — the cited substring must still exist), and whether the file
// has any RUNTIME behaviour (the producer gate). A declaration-only file has neither a
// call nor a function/method body, so it can describe a channel but never serve one.
export type FileAnchors = { readonly texts: ReadonlySet<string>; readonly hasRuntime: boolean };
export type AnchorIndex = ReadonlyMap<string, FileAnchors>;

// Runtime behaviour, from normalized facts only: the file invokes something, or it
// defines an executable body. Pure type declarations (interfaces/types/enums, bare
// data classes, constants) have neither — language-structural, no framework knowledge.
function fileHasRuntime(file: FileFacts): boolean {
  return file.calls.length > 0 || file.symbols.some((s) => s.kind === "function" || s.kind === "method");
}

export function indexAnchors(facts: readonly FileFacts[]): AnchorIndex {
  const texts = new Map<string, Set<string>>();
  const runtime = new Map<string, boolean>();
  for (const file of facts) {
    let set = texts.get(file.path);
    if (!set) texts.set(file.path, (set = new Set()));
    for (const a of file.anchors ?? []) set.add(a.text);
    // A path can span multiple FileFacts (e.g. partials); runtime in any one counts.
    runtime.set(file.path, (runtime.get(file.path) ?? false) || fileHasRuntime(file));
  }
  const index = new Map<string, FileAnchors>();
  for (const [path, set] of texts) index.set(path, { texts: set, hasRuntime: runtime.get(path) ?? false });
  return index;
}

// Verify one channel against current facts. Each membership whose anchor re-finds is
// kept and promoted to confidence "verified"; one whose anchor is gone is dropped. A
// channel survives only if verified memberships still span >=2 services — otherwise
// there is no edge to draw, and we return null (silent omission, never a false edge).
export function verifyChannel(channel: Channel, index: AnchorIndex): Channel | null {
  const verified: ChannelMembership[] = [];
  for (const m of channel.memberships) {
    const file = index.get(m.anchor.file);
    if (!file?.texts.has(m.anchor.text)) continue; // anchor must re-find (existence)
    // Role gate: a producer must be backed by runtime behaviour. An anchor the model
    // labelled produce/both that sits in a declaration-only file can't serve the
    // channel — drop it (and with it any edge it would have anchored). EXCEPTION: a
    // service IDL (.proto `service{rpc}`, OpenAPI path) authoritatively declares a
    // served endpoint — unlike a bare type/DTO declaration, it IS producer evidence.
    // contractKeyAnchors only fires on these interface declarations, so the .d.ts gate
    // (non-contract declaration files) is untouched.
    const produces = m.role === "produce" || m.role === "both";
    if (produces && !file.hasRuntime && !isContractFile(m.anchor.file)) continue;
    verified.push({ ...m, confidence: "verified" });
  }
  if (new Set(verified.map((m) => m.service)).size < 2) return null;
  return { ...channel, memberships: verified };
}

export function verifyChannels(channels: readonly Channel[], facts: readonly FileFacts[]): Channel[] {
  const index = indexAnchors(facts);
  const out: Channel[] = [];
  for (const channel of channels) {
    const v = verifyChannel(channel, index);
    if (v) out.push(v);
  }
  return out;
}

// --- Identity & cache (determinism) ---------------------------------------------

// Stable identity of a channel: its normalized KEY. surfaceChannelCandidates yields
// exactly one channel per key (all services sharing a key merge into one M×N channel),
// so the key alone is a position-independent id (§I5). Keying on the first/last service
// instead collapsed distinct service sets and mis-tracked member/producer changes across
// runs (a renamed-away provider read as a benign "changed" instead of a break).
export function channelId(channel: Channel): string {
  return channelClaimId(channel.key, "", "");
}

// Hash of a candidate's EVIDENCE — its endpoints (file+text), order-independent. If
// unchanged since last run, the prior adjudication is reused verbatim (no model call).
export function candidateAnchorHash(candidate: ChannelCandidate): string {
  return endpointsHash(candidate.endpoints.map((e) => `${e.file} ${e.text}`));
}

export function channelAnchorHash(channel: Channel): string {
  return endpointsHash(channel.memberships.map((m) => `${m.anchor.file} ${m.anchor.text}`));
}

function endpointsHash(parts: readonly string[]): string {
  const sorted = [...parts].sort();
  // anchorHash pairs two endpoints; for N endpoints hash the canonical joined list.
  return sorted.length === 2 ? anchorHash(sorted[0]!, "", sorted[1]!, "") : sha256(sorted.join("\n"));
}

// Split candidates into cache HITS (evidence unchanged → reuse the cached channel,
// skip the model) and MISSES (new/changed → must be re-adjudicated). The cache maps
// candidateAnchorHash → the channel last produced for it.
export function partitionByCache(
  candidates: readonly ChannelCandidate[],
  cache: ReadonlyMap<string, Channel>
): { readonly hits: Channel[]; readonly misses: ChannelCandidate[] } {
  const hits: Channel[] = [];
  const misses: ChannelCandidate[] = [];
  for (const candidate of candidates) {
    const cached = cache.get(candidateAnchorHash(candidate));
    if (cached) hits.push(cached);
    else misses.push(candidate);
  }
  return { hits, misses };
}

// --- Derived views ---------------------------------------------------------------

// Pairwise edge views for rendering/scoring (plan §11.1: a DERIVED view, never the
// stored truth). A consumer calls each producer in another service; "both" plays
// both sides. An M-producer × N-consumer topic yields the real pairs, but is still
// ONE channel — callers render it as a cluster, not a mesh.
export function channelEdgeViews(channel: Channel): ChannelEdgeView[] {
  const producers = channel.memberships.filter((m) => m.role === "produce" || m.role === "both");
  const consumers = channel.memberships.filter((m) => m.role === "consume" || m.role === "both");
  const out = new Map<string, ChannelEdgeView>();
  for (const p of producers) {
    for (const c of consumers) {
      if (c.service === p.service) continue;
      const id = `${c.service}->${p.service}`;
      if (!out.has(id)) out.set(id, { from: c.service, to: p.service, channelKey: channel.key, kind: channel.kind });
    }
  }
  return [...out.values()];
}
