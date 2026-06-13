// The blast radius: changed paths -> the ImpactSlice (seam ∪ file-level).
//
// Runs against the BEFORE model (the session-start baseline), so a file the
// agent deleted is still in the graph and its dependents are still found.
// Deterministic and complete by construction: every affected file comes off a
// real import edge, every consumer off a real seam occurrence — none invented.

import type { Baseline, WorkspaceModel } from "@mappamind_/baseline";
import type { SeamReport, ServiceGraph } from "@mappamind_/seam";

import { buildReverseEdges } from "./reverseIndex.js";
import type {
  AffectedCapability,
  AffectedFile,
  AtRiskContract,
  AtRiskServiceEdge,
  ImpactSlice
} from "./types.js";

export type BlastRadiusInput = {
  readonly model: WorkspaceModel;
  readonly changedPaths: readonly string[];
  readonly baseline?: Baseline;
  readonly seams?: SeamReport;
  readonly mesh?: ServiceGraph;
  // Files that consume contracts proven broken by a before/after mesh diff.
  // They are not import dependents, but they can still ground behavior chips.
  readonly brokenContractConsumerFiles?: readonly string[];
  // Optional cap on BFS depth. UNBOUNDED by default: barrel re-exports make real
  // chains deep (page -> barrel -> component -> barrel -> util is depth 4+), and
  // on the POC-B ground truth a depth-3 cap silently dropped 13/38 true
  // dependents — the exact false-"safe" that breaks trust. The walk is linear
  // and milliseconds-fast, so completeness costs nothing.
  readonly maxDepth?: number;
};

const DEFAULT_MAX_DEPTH = Number.POSITIVE_INFINITY;

type AffectedWalk = {
  readonly affectedFiles: AffectedFile[];
  readonly reExportCarriers: readonly string[];
};

// Reverse-BFS from the changed set. Depth = distance from the nearest seed;
// a changed file is never its own dependent.
function findAffectedFiles(
  model: WorkspaceModel,
  changed: ReadonlySet<string>,
  maxDepth: number
): AffectedWalk {
  const reverse = buildReverseEdges(model);
  const depthOf = new Map<string, number>();
  const reExportCarriers = new Set<string>();
  let frontier = [...changed].sort();
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const file of frontier) {
      for (const edge of reverse.get(file) ?? []) {
        const dependent = edge.path;
        if (depthOf.has(dependent) || changed.has(dependent)) {
          continue;
        }
        depthOf.set(dependent, depth);
        if (edge.edgeKind === "re-export") {
          reExportCarriers.add(dependent);
        }
        next.push(dependent);
      }
    }
    frontier = next.sort();
  }
  return {
    affectedFiles: [...depthOf.entries()]
      .map(([path, depth]) => ({ path, depth }))
      .sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    reExportCarriers: [...reExportCarriers].sort()
  };
}

// Baseline capabilities with a member in the changed ∪ affected set. Context
// for the card; capabilities of a changed leaf do not block the cosmetic fold.
function findAffectedCapabilities(
  baseline: Baseline,
  hit: ReadonlySet<string>
): AffectedCapability[] {
  const affected: AffectedCapability[] = [];
  for (const capability of baseline.capabilities) {
    const viaFiles = [...new Set(capability.members.map((member) => member.file).filter((file) => hit.has(file)))];
    if (viaFiles.length > 0) {
      affected.push({ id: capability.id, name: capability.name, viaFiles: viaFiles.sort() });
    }
  }
  return affected.sort((a, b) => a.name.localeCompare(b.name));
}

// Seam contracts whose definition site changed -> their references (consumers).
function findAtRiskContracts(seams: SeamReport, changed: ReadonlySet<string>): AtRiskContract[] {
  const atRisk: AtRiskContract[] = [];
  for (const contract of seams.contracts) {
    const definedIn = [...new Set(contract.definitions.map((d) => d.file).filter((file) => changed.has(file)))];
    if (definedIn.length === 0 || contract.references.length === 0) {
      continue;
    }
    atRisk.push({
      key: contract.key,
      ...(contract.seamType ? { seamType: contract.seamType } : {}),
      definedIn: definedIn.sort(),
      consumers: contract.references
    });
  }
  return atRisk.sort((a, b) => a.key.localeCompare(b.key));
}

// Mesh edges whose provider service contains a changed file. A service is a
// path prefix (src/checkout, lib, ...) — exactly how the mesh built it.
function findAtRiskServiceEdges(mesh: ServiceGraph, changed: ReadonlySet<string>): AtRiskServiceEdge[] {
  const changedServices = new Set<string>();
  for (const service of mesh.services) {
    for (const path of changed) {
      if (path === service || path.startsWith(`${service}/`)) {
        changedServices.add(service);
        break;
      }
    }
  }
  return mesh.edges
    .filter((edge) => changedServices.has(edge.to))
    .map((edge) => ({ consumer: edge.from, provider: edge.to, contract: edge.contract }))
    .sort((a, b) => a.consumer.localeCompare(b.consumer) || a.contract.localeCompare(b.contract));
}

export function computeBlastRadius(input: BlastRadiusInput): ImpactSlice {
  const known = new Set(input.model.modules.map((module) => module.path));
  const changedPaths = [...new Set(input.changedPaths)].filter((path) => known.has(path)).sort();
  const unknownPaths = [...new Set(input.changedPaths)].filter((path) => !known.has(path)).sort();
  const changed = new Set(changedPaths);

  const { affectedFiles, reExportCarriers } = findAffectedFiles(input.model, changed, input.maxDepth ?? DEFAULT_MAX_DEPTH);
  const hit = new Set([
    ...changed,
    ...affectedFiles.map((file) => file.path),
    ...(input.brokenContractConsumerFiles ?? [])
  ]);

  const affectedCapabilities = input.baseline ? findAffectedCapabilities(input.baseline, hit) : [];
  const atRiskContracts = input.seams ? findAtRiskContracts(input.seams, changed) : [];
  const atRiskServiceEdges = input.mesh ? findAtRiskServiceEdges(input.mesh, changed) : [];

  return {
    changedPaths,
    unknownPaths,
    affectedFiles,
    affectedCapabilities,
    atRiskContracts,
    atRiskServiceEdges,
    reExportCarriers,
    cosmetic:
      affectedFiles.length === 0 && atRiskContracts.length === 0 && atRiskServiceEdges.length === 0
  };
}
