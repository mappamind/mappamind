// The cross-service mesh, assembled the v2 way (plan Phase 4 wiring + Phase 5).
//
// Replaces the old synchronous catcher (detectServiceArchitecture) with the full
// claim→verify pipeline: detect boundaries (frozen) → surface candidates → model
// adjudicates → verifier re-finds the anchors → assemble the graph from what
// survived. The model proposes; the verifier (not the model) writes the edges.
//
// A cache of previously-verified channels (keyed by candidate anchor hash) lets an
// unchanged candidate skip the model entirely (§I5/I7) — at the accept moment the
// "before" mesh reuses the baseline's channels and only changed candidates re-run.

import type { Channel } from "@mappamind_/seam";
import {
  buildServiceGraph,
  candidateAnchorHash,
  detectServiceBoundaries,
  partitionByCache,
  surfaceChannelCandidates,
  verifyChannels
} from "@mappamind_/seam";
import type { ServiceGraph } from "@mappamind_/seam";
import type { FileFacts } from "@mappamind_/extractors";
import { adjudicateChannels } from "@mappamind_/synthesis";
import type { ModelClient } from "@mappamind_/synthesis";

export type BuildMeshInput = {
  readonly files: readonly FileFacts[];
  readonly client: ModelClient;
  // Previously-verified channels keyed by candidateAnchorHash — a hit skips the model.
  readonly cache?: ReadonlyMap<string, Channel>;
  // Full source text per path, for the adjudicator's code-context excerpts.
  readonly sources?: ReadonlyMap<string, string>;
  readonly redTeam?: boolean;
  // The agent's session transcript (Phase 7) — an untrusted hint that focuses
  // adjudication on what the session touched; the verifier still gates every claim.
  readonly transcript?: string;
};

export type BuildMeshResult = {
  readonly graph: ServiceGraph;
  readonly channels: readonly Channel[]; // verified channels behind the graph
  // candidateAnchorHash -> verified channel, ready to pass as the next run's `cache`
  // so an unchanged candidate reuses this channel instead of re-calling the model.
  readonly cache: ReadonlyMap<string, Channel>;
};

export async function buildServiceMesh(input: BuildMeshInput): Promise<BuildMeshResult> {
  const boundaries = detectServiceBoundaries(input.files);
  const candidates = surfaceChannelCandidates(input.files, boundaries.serviceByPath);

  const { hits, misses } = input.cache
    ? partitionByCache(candidates, input.cache)
    : { hits: [] as Channel[], misses: [...candidates] };

  const adjudicated =
    misses.length > 0
      ? await adjudicateChannels({
          candidates: misses,
          client: input.client,
          ...(input.sources ? { sources: input.sources } : {}),
          ...(input.redTeam ? { redTeam: input.redTeam } : {}),
          ...(input.transcript ? { transcript: input.transcript } : {})
        })
      : { channels: [] as Channel[], calls: [] };

  // The verifier is the sole writer: re-find every cited anchor in the CURRENT facts.
  const channels = verifyChannels([...hits, ...adjudicated.channels], input.files);
  const graph = buildServiceGraph(boundaries, channels);

  // Build the next-run cache keyed by candidate evidence. surfaceChannelCandidates
  // yields one candidate per normalized key, so pairing a channel to its candidate
  // by key is unambiguous; the key lets a future run match unchanged evidence.
  const candidateByKey = new Map(candidates.map((c) => [c.key, c]));
  const cache = new Map<string, Channel>();
  for (const channel of channels) {
    const candidate = candidateByKey.get(channel.key);
    if (candidate) cache.set(candidateAnchorHash(candidate), channel);
  }
  return { graph, channels, cache };
}
