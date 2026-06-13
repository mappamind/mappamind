// The reverse import index: file -> the files that import it.
//
// Derived in memory from model.edges on every load — never persisted (PLAN 2a).
// The model's edges already carry re-exports (a barrel `export ... from` is an
// edge), so walking this index follows barrels transitively. Edges remember the
// re-export kind so the blast-radius walk can name the barrel carriers.

import type { WorkspaceModel } from "@mappamind_/baseline";

// One reverse edge: a file that imports the target, and how (a barrel re-export
// is flagged so downstream can count the carriers separately).
export type ReverseEdge = {
  readonly path: string;
  readonly edgeKind?: "re-export";
};

export type ReverseEdgeIndex = ReadonlyMap<string, readonly ReverseEdge[]>;
export type ReverseIndex = ReadonlyMap<string, readonly string[]>;

// The canonical builder: file -> the reverse edges that reach it. A file
// importing the same target twice collapses to one edge; if any of those
// duplicate edges is a re-export, the edge is marked as one.
export function buildReverseEdges(model: WorkspaceModel): ReverseEdgeIndex {
  const importedBy = new Map<string, ReverseEdge[]>();
  const byKey = new Map<string, { path: string; edgeKind?: "re-export" }>();
  for (const edge of model.edges) {
    const key = `${edge.from}${edge.to}`;
    const existing = byKey.get(key);
    if (existing) {
      if (edge.edgeKind === "re-export") {
        existing.edgeKind = "re-export";
      }
      continue; // a file importing the same target twice is one dependency
    }
    const reverseEdge: ReverseEdge = { path: edge.from, ...(edge.edgeKind ? { edgeKind: edge.edgeKind } : {}) };
    byKey.set(key, reverseEdge);
    const list = importedBy.get(edge.to);
    if (list) {
      list.push(reverseEdge);
    } else {
      importedBy.set(edge.to, [reverseEdge]);
    }
  }
  for (const edges of importedBy.values()) {
    edges.sort((a, b) => a.path.localeCompare(b.path));
  }
  return importedBy;
}

// Path-only view, for callers that don't care how a dependency was reached.
export function buildReverseIndex(model: WorkspaceModel): ReverseIndex {
  const paths = new Map<string, string[]>();
  for (const [target, edges] of buildReverseEdges(model)) {
    paths.set(target, edges.map((edge) => edge.path));
  }
  return paths;
}
