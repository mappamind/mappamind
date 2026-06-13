// The cross-service mesh — render contract + graph assembly (post-catcher).
//
// The RPC-naming regex catcher (CLIENT_RE / contractFromCallee) is GONE (plan
// Phase 5, C1): recognition is no longer pattern-matched in our code. Edges now
// come from VERIFIED channels (model-adjudicated, anchor-verified) via the channel
// pipeline; this module only (a) keeps the ServiceGraph/ServiceEdge types every
// renderer speaks, and (b) assembles a graph from boundaries + verified channels.
// Boundary detection lives in serviceBoundary.ts (frozen, C3).

import type { Channel } from "./channel.js";
import type { ServiceBoundaries } from "./serviceBoundary.js";
import { channelEdgeViews } from "./verifyChannel.js";

export type ServiceEdge = {
  readonly from: string;
  readonly to: string;
  readonly contract: string; // the channel key (route/topic/contract) the edge rides
};

export type DanglingContract = {
  readonly service: string;
  readonly contract: string;
  readonly file: string;
  readonly line: number;
};

export type ServiceGraph = {
  readonly services: readonly string[];
  readonly edges: readonly ServiceEdge[];
  readonly dangling: readonly DanglingContract[];
};

// Assemble the mesh from detected boundaries and the verified channels. Every edge
// is a derived consumer→producer view of a real channel whose anchors re-found
// (§I2) — the verifier, not the model, is what put it here. An M×N channel yields
// its real pairs but remains one channel upstream; this graph is the flattened view
// the existing renderers consume. `dangling` is empty: a broken/dangling consumer is
// now surfaced at shift time by the mesh diff, not guessed from a naming regex.
export function buildServiceGraph(boundaries: ServiceBoundaries, channels: readonly Channel[]): ServiceGraph {
  const edges = new Map<string, ServiceEdge>();
  for (const channel of channels) {
    for (const view of channelEdgeViews(channel)) {
      if (view.from === view.to) continue;
      const id = `${view.from}->${view.to}:${view.channelKey}`;
      if (!edges.has(id)) edges.set(id, { from: view.from, to: view.to, contract: view.channelKey });
    }
  }
  return {
    services: [...boundaries.services],
    edges: [...edges.values()].sort(
      (a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.contract.localeCompare(b.contract)
    ),
    dangling: []
  };
}
