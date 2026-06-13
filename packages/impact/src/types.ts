// The impact model: what one agent session's change touches, deterministically.
//
// POC-G locked the substrate: the slice is the UNION of two layers, because each
// is blind where the other sees (POC-A: imports are blind to a contract break;
// POC-B: the seam is blind to intra-service util fan-out).
//   - file-level: reverse-BFS over the import graph (with re-export edges)
//   - seam-level: contracts whose definition site changed -> their consumers,
//     and mesh consumers of any service that contains a changed file
// Everything here is derived from real facts; nothing is proposed or guessed —
// the slice is what the leashed narrator is ALLOWED to talk about.

import type { Occurrence } from "@mappamind_/seam";

// A real dependent of a changed file, found by reverse-BFS. `depth` is the
// distance from the nearest changed file (1 = imports it directly).
export type AffectedFile = {
  readonly path: string;
  readonly depth: number;
};

// A baseline capability with a member in the changed, import-affected, or
// broken-contract consumer set.
export type AffectedCapability = {
  readonly id: string;
  readonly name: string;
  readonly viaFiles: readonly string[]; // the members that put it in the slice
};

// A seam contract whose definition lives in a changed file: every reference to
// it is a consumer that may now be broken. "At risk", not "broken" — broken is
// a before/after question (see meshDiff.ts).
export type AtRiskContract = {
  readonly key: string;
  readonly seamType?: string;
  readonly definedIn: readonly string[]; // changed files that define it
  readonly consumers: readonly Occurrence[];
};

// A mesh edge whose provider service contains a changed file: the consumer
// service is at risk on that contract. Deliberately a superset (any change in
// the provider flags it) — a missed dependent is the failure mode that breaks
// trust; an extra one is a glance.
export type AtRiskServiceEdge = {
  readonly consumer: string;
  readonly provider: string;
  readonly contract: string;
};

export type ImpactSlice = {
  // Changed paths that exist in the model (the seeds of the BFS).
  readonly changedPaths: readonly string[];
  // Changed paths the model does not know (docs, assets, deleted-and-unknown).
  // Counted, never hidden — but they cannot have dependents.
  readonly unknownPaths: readonly string[];
  readonly affectedFiles: readonly AffectedFile[];
  readonly affectedCapabilities: readonly AffectedCapability[];
  readonly atRiskContracts: readonly AtRiskContract[];
  readonly atRiskServiceEdges: readonly AtRiskServiceEdge[];
  // Distinct barrel files reached by traversing a re-export edge. Used for the
  // rollup card's "barrel re-exports carry it" count.
  readonly reExportCarriers?: readonly string[];
  // Nothing downstream was hit: no dependents, no at-risk contracts or mesh
  // consumers. The anti-noise gate — a cosmetic slice folds, no alarm.
  readonly cosmetic: boolean;
};
