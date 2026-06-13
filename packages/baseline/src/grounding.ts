// The grounding leash (M3b, Point 1).
//
// The LLM proposes; this disposes. Every member citation must resolve to a real
// file (and, if it names a symbol, a real symbol) in the facts. A capability with
// zero surviving members is DROPPED. An edge is admitted only if a real dependency
// edge backs it. Confidence is set HERE, from grounding strength — never by the
// model. Nothing untrusted gets past this function. Drops are returned, not hidden.

import type { RepoFiles, WorkspaceModel } from "./model.js";
import type {
  Baseline,
  Capability,
  CapabilityEdge,
  Citation,
  Confidence,
  DroppedCapability,
  DroppedEdge,
  GroundingResult,
  ProposedBaseline
} from "./capabilities.js";

// repo -> file -> (symbol name -> first line). Built from facts, used to verify
// that a cited file and symbol actually exist.
type SymbolIndex = Map<string, Map<string, Map<string, number>>>;

function buildSymbolIndex(repos: readonly RepoFiles[]): SymbolIndex {
  const index: SymbolIndex = new Map();
  for (const repo of repos) {
    const files = new Map<string, Map<string, number>>();
    for (const file of repo.files) {
      const symbols = new Map<string, number>();
      for (const symbol of file.symbols) {
        if (!symbols.has(symbol.name)) {
          symbols.set(symbol.name, symbol.line);
        }
      }
      for (const exported of file.exports) {
        if (!symbols.has(exported.name)) {
          symbols.set(exported.name, exported.line);
        }
      }
      files.set(file.path, symbols);
    }
    index.set(repo.repo, files);
  }
  return index;
}

// Verify one citation. Returns a normalized citation (line filled in from facts
// when the symbol is known) or null if it does not resolve to real code.
function groundCitation(citation: Citation, index: SymbolIndex): Citation | null {
  const repoFiles = index.get(citation.repo);
  if (!repoFiles) {
    return null;
  }
  const symbols = repoFiles.get(citation.file);
  if (!symbols) {
    return null; // cited a file that does not exist
  }
  if (citation.symbol !== undefined) {
    const line = symbols.get(citation.symbol);
    if (line === undefined) {
      return null; // cited a symbol that does not exist in that file
    }
    return { repo: citation.repo, file: citation.file, symbol: citation.symbol, line: citation.line ?? line };
  }
  return citation.line !== undefined
    ? { repo: citation.repo, file: citation.file, line: citation.line }
    : { repo: citation.repo, file: citation.file };
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `cap_${base || "unnamed"}`;
}

// High when grounding is strong: a symbol-level citation, or several files. A lone
// file-level member is medium — real, but coarse.
function confidenceFor(members: readonly Citation[]): Confidence {
  const hasSymbol = members.some((member) => member.symbol !== undefined);
  if (hasSymbol || members.length >= 2) {
    return "high";
  }
  return "medium";
}

export function groundBaseline(
  proposed: ProposedBaseline,
  repos: readonly RepoFiles[],
  model: WorkspaceModel,
  workspaceId: string,
  factsHash: string
): GroundingResult {
  const index = buildSymbolIndex(repos);

  const capabilities: Capability[] = [];
  const droppedCapabilities: DroppedCapability[] = [];
  const usedIds = new Set<string>();
  const idByName = new Map<string, string>();
  const filesById = new Map<string, Set<string>>();

  for (const candidate of proposed.capabilities) {
    const members = candidate.members
      .map((member) => groundCitation(member, index))
      .filter((member): member is Citation => member !== null);

    if (members.length === 0) {
      droppedCapabilities.push({ name: candidate.name, reason: "no-grounded-members" });
      continue;
    }

    let id = slug(candidate.name);
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${slug(candidate.name)}_${suffix++}`;
    }
    usedIds.add(id);
    idByName.set(candidate.name, id);
    filesById.set(id, new Set(members.map((member) => member.file)));

    capabilities.push({
      id,
      name: candidate.name,
      summary: candidate.summary,
      members,
      provenance: "derived",
      confidence: confidenceFor(members)
    });
  }

  // Edges: admit only when a real dependency edge connects a member file of `from`
  // to a member file of `to`, in that direction. (Seam-backed edges fold in when
  // M2's SeamReport is wired into this call; dependency edges are the v1 backing.)
  const edges: CapabilityEdge[] = [];
  const droppedEdges: DroppedEdge[] = [];

  for (const proposedEdge of proposed.edges) {
    const fromId = idByName.get(proposedEdge.from);
    const toId = idByName.get(proposedEdge.to);
    if (!fromId || !toId || fromId === toId) {
      droppedEdges.push({ from: proposedEdge.from, to: proposedEdge.to, reason: "unknown-capability" });
      continue;
    }
    const fromFiles = filesById.get(fromId) ?? new Set<string>();
    const toFiles = filesById.get(toId) ?? new Set<string>();
    const backing = model.edges.find((edge) => fromFiles.has(edge.from) && toFiles.has(edge.to));
    if (!backing) {
      droppedEdges.push({ from: proposedEdge.from, to: proposedEdge.to, reason: "no-backing-edge" });
      continue;
    }
    edges.push({
      from: fromId,
      to: toId,
      via: "dependency",
      evidence: { repo: backing.repo, file: backing.from }
    });
  }

  const baseline: Baseline = {
    schemaVersion: 1,
    workspaceId,
    derivedFrom: { factsHash },
    capabilities,
    edges,
    unknowns: proposed.unknowns.map((unknown) => ({ note: unknown.note, ...(unknown.where ? { where: unknown.where } : {}) }))
  };

  return { baseline, droppedCapabilities, droppedEdges };
}
