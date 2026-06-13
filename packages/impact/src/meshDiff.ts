// The before/after mesh diff: what an agent session DID to the service graph.
//
// This is the POC-A signal, productized. "At risk" (blastRadius.ts) is what a
// change MIGHT break, from the before model alone; this is what it DID break —
// a consumer whose contract no longer resolves is a NEW dangling. Pre-existing
// danglings (external SDKs like secretmanager, POC-D) are baseline state, not
// this session's damage, so the diff excludes them by construction.

import type { DanglingContract, ServiceEdge, ServiceGraph } from "@mappamind_/seam";

export type MeshDiff = {
  // Danglings present after but not before: the session severed these.
  readonly brokenContracts: readonly DanglingContract[];
  readonly lostEdges: readonly ServiceEdge[];
  readonly newEdges: readonly ServiceEdge[];
  readonly removedServices: readonly string[];
  readonly addedServices: readonly string[];
};

const danglingKey = (d: DanglingContract): string => `${d.service}::${d.contract}`;
const edgeKey = (e: ServiceEdge): string => `${e.from}->${e.to}::${e.contract}`;

export function diffServiceGraphs(before: ServiceGraph, after: ServiceGraph): MeshDiff {
  const beforeDangling = new Set(before.dangling.map(danglingKey));
  const beforeEdges = new Set(before.edges.map(edgeKey));
  const afterEdges = new Set(after.edges.map(edgeKey));
  const beforeServices = new Set(before.services);
  const afterServices = new Set(after.services);

  return {
    brokenContracts: after.dangling.filter((d) => !beforeDangling.has(danglingKey(d))),
    lostEdges: before.edges.filter((e) => !afterEdges.has(edgeKey(e))),
    newEdges: after.edges.filter((e) => !beforeEdges.has(edgeKey(e))),
    removedServices: before.services.filter((s) => !afterServices.has(s)),
    addedServices: after.services.filter((s) => !beforeServices.has(s))
  };
}
