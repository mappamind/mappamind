// The agnostic seam engine.
//
// Backbone (no technology knowledge): a string-literal call argument is a
// REFERENCE; an export or declared symbol is a DEFINITION. A key referenced in one
// repo and defined in another is a cross-boundary contract — found without knowing
// the technology. Conventions (declarative data) then label those, raise
// confidence, and let us call a reference "dangling" when it was meant to resolve.

import { DEFAULT_CONVENTIONS, type SeamConvention } from "./conventions.js";
import type {
  Confidence,
  Occurrence,
  RepoFacts,
  SeamContract,
  SeamReport,
  SeamStatus
} from "./types.js";

export { DEFAULT_CONVENTIONS };

function lastSegment(callee: string): string {
  const dot = callee.lastIndexOf(".");
  return dot >= 0 ? callee.slice(dot + 1) : callee;
}

// A key worth considering: an identifier or path, not prose. This is what keeps
// the backbone from treating every log message as a contract.
function keyLike(value: string): boolean {
  if (value.length < 2 || value.length > 100) {
    return false;
  }
  if (/\s/.test(value) || !/[A-Za-z]/.test(value)) {
    return false;
  }
  return /^[\w./:@$-]+$/.test(value);
}

type Bucket = Map<string, Occurrence[]>;

function add(bucket: Bucket, occurrence: Occurrence): void {
  const existing = bucket.get(occurrence.key);
  if (existing) {
    existing.push(occurrence);
  } else {
    bucket.set(occurrence.key, [occurrence]);
  }
}

function markerCallLines(
  file: RepoFacts["files"][number],
  markers: readonly string[]
): Set<number> {
  const lines = new Set<number>();
  for (const call of file.calls) {
    if (markers.includes(lastSegment(call.callee))) {
      lines.add(call.line);
    }
  }
  return lines;
}

// Collapse occurrences at the same site, preferring the convention-labeled one.
function dedupe(occurrences: readonly Occurrence[]): Occurrence[] {
  const bySite = new Map<string, Occurrence>();
  for (const occurrence of occurrences) {
    const site = `${occurrence.repo}::${occurrence.file}::${occurrence.line}::${occurrence.side}`;
    const existing = bySite.get(site);
    if (!existing || (!existing.seamType && occurrence.seamType)) {
      bySite.set(site, occurrence);
    }
  }
  return [...bySite.values()];
}

export function detectSeams(
  repos: readonly RepoFacts[],
  conventions: readonly SeamConvention[] = DEFAULT_CONVENTIONS
): SeamReport {
  const genericRefs: Bucket = new Map();
  const genericDefs: Bucket = new Map();
  const conventionRefs: Bucket = new Map();
  const conventionDefs: Bucket = new Map();
  const mustResolve = new Set<string>();

  for (const repo of repos) {
    for (const file of repo.files) {
      // Backbone references: every key-like string argument.
      for (const call of file.calls) {
        for (const arg of call.args) {
          if (keyLike(arg)) {
            add(genericRefs, {
              key: arg,
              side: "reference",
              kind: "string-arg",
              repo: repo.repo,
              file: file.path,
              line: call.line,
              via: call.callee
            });
          }
        }
      }
      // Backbone definitions: names this module provides.
      for (const exported of file.exports) {
        add(genericDefs, { key: exported.name, side: "definition", kind: "export", repo: repo.repo, file: file.path, line: exported.line });
      }
      for (const symbol of file.symbols) {
        add(genericDefs, { key: symbol.name, side: "definition", kind: "symbol", repo: repo.repo, file: file.path, line: symbol.line });
      }

      // Conventions (declarative refinement).
      for (const convention of conventions) {
        if (convention.reference) {
          for (const call of file.calls) {
            if (convention.reference.callees.includes(lastSegment(call.callee))) {
              const key = call.args[convention.reference.keyArg];
              if (key) {
                add(conventionRefs, {
                  key,
                  side: "reference",
                  kind: "string-arg",
                  repo: repo.repo,
                  file: file.path,
                  line: call.line,
                  via: call.callee,
                  seamType: convention.id
                });
                if (convention.reference.mustResolve) {
                  mustResolve.add(key);
                }
              }
            }
          }
        }
        if (convention.providerFromExportsOf) {
          const markers = convention.providerFromExportsOf.callees;
          const definitionLines = markerCallLines(file, markers);
          if (definitionLines.size > 0) {
            for (const exported of file.exports) {
              if (!definitionLines.has(exported.line)) {
                continue;
              }
              add(conventionDefs, {
                key: exported.name,
                side: "definition",
                kind: "export",
                repo: repo.repo,
                file: file.path,
                line: exported.line,
                seamType: convention.id
              });
            }
          }
        }
      }
    }
  }

  const allKeys = new Set<string>([
    ...conventionRefs.keys(),
    ...conventionDefs.keys(),
    ...genericRefs.keys()
  ]);

  const contracts: SeamContract[] = [];
  for (const key of allKeys) {
    const cRefs = conventionRefs.get(key) ?? [];
    const cDefs = conventionDefs.get(key) ?? [];
    const gRefs = genericRefs.get(key) ?? [];
    const gDefs = genericDefs.get(key) ?? [];

    const referenceRepos = new Set([...cRefs, ...gRefs].map((reference) => reference.repo));
    // A backbone definition only counts if it lives in a different repo than a
    // reference (cross-boundary); within-repo name collisions are not seams.
    const crossRepoDefs = gDefs.filter((definition) => [...referenceRepos].some((repo) => repo !== definition.repo));
    const definitions = dedupe([...cDefs, ...crossRepoDefs]);

    // A reference only counts toward in_sync if a convention recognized it, or it
    // is cross-repo to a definition. A same-repo string mention is not consumption.
    const references = dedupe([
      ...cRefs,
      ...gRefs.filter((reference) => definitions.some((definition) => definition.repo !== reference.repo))
    ]);

    const isConvention = cRefs.length > 0 || cDefs.length > 0;
    const interesting = isConvention || (gRefs.length > 0 && crossRepoDefs.length > 0);
    if (!interesting) {
      continue;
    }

    let status: SeamStatus;
    if (definitions.length > 0 && references.length > 0) {
      status = "in_sync";
    } else if (references.length > 0) {
      // Only a convention can assert a reference was meant to resolve. A bare
      // backbone reference with no match might point outside the workspace.
      if (!mustResolve.has(key)) {
        continue;
      }
      status = "dangling";
    } else if (definitions.length > 0) {
      status = "orphan";
    } else {
      continue;
    }

    const crossesBoundary = references.some((reference) =>
      definitions.some((definition) => definition.repo !== reference.repo)
    );
    const confidence: Confidence = isConvention ? "high" : "medium";
    const seamType = cRefs[0]?.seamType ?? cDefs[0]?.seamType;

    contracts.push({
      key,
      status,
      confidence,
      ...(seamType ? { seamType } : {}),
      crossesBoundary,
      references,
      definitions
    });
  }

  const statusRank: Record<SeamStatus, number> = { dangling: 0, in_sync: 1, orphan: 2 };
  const confidenceRank: Record<Confidence, number> = { high: 0, medium: 1 };
  contracts.sort(
    (a, b) =>
      statusRank[a.status] - statusRank[b.status] ||
      confidenceRank[a.confidence] - confidenceRank[b.confidence] ||
      a.key.localeCompare(b.key)
  );

  const dangling = contracts.filter((contract) => contract.status === "dangling");
  return { contracts, dangling };
}
