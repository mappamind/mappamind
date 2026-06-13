// Score a produced baseline against ratified ground truth (M3b, Point 2).
//
// Matching is by FILE OVERLAP, never by name — the model's wording cannot inflate
// the score. A produced capability matches a ground-truth one when they share files;
// greedy best-overlap assignment prevents one produced capability from claiming
// several expected ones. Precision is the hard gate (a push tool that cries wolf is
// dead); recall is softer (missing a few is survivable). Citation precision measures
// whether cited files are in-scope at all. Legibility stays human (not auto-scored).

import type { Baseline } from "@mappamind_/baseline";

import type { GroundTruth } from "./groundTruth.js";

export type Thresholds = {
  readonly precision: number;
  readonly recall: number;
  readonly citation: number;
};

// Spec Point 2a defaults. Precision is the hard gate.
export const DEFAULT_THRESHOLDS: Thresholds = { precision: 0.9, recall: 0.7, citation: 0.95 };

export type Match = {
  readonly produced: string; // produced capability name
  readonly expected: string; // matched ground-truth capability name
  readonly sharedFiles: number;
};

export type ScoreReport = {
  readonly label: string;
  readonly producedCount: number;
  readonly expectedCount: number;
  readonly matchedCount: number;
  readonly precision: number;
  readonly recall: number;
  readonly citationPrecision: number;
  readonly matches: readonly Match[];
  readonly falsePositives: readonly string[]; // produced capabilities matching no GT
  readonly missed: readonly string[]; // GT capabilities no produced capability covered
  readonly pass: {
    readonly precision: boolean;
    readonly recall: boolean;
    readonly citation: boolean;
    readonly overall: boolean;
  };
};

function fileKeysOf(baseline: Baseline): { name: string; files: Set<string> }[] {
  return baseline.capabilities.map((cap) => ({
    name: cap.name,
    files: new Set(cap.members.map((member) => `${member.repo}/${member.file}`))
  }));
}

function intersectionSize(a: Set<string>, b: ReadonlySet<string>): number {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) {
      count += 1;
    }
  }
  return count;
}

export function scoreBaseline(
  baseline: Baseline,
  groundTruth: GroundTruth,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): ScoreReport {
  const produced = fileKeysOf(baseline);
  const expected = groundTruth.capabilities.map((cap) => ({ name: cap.name, files: new Set(cap.files) }));

  // Every candidate (produced, expected) pair that shares >=1 file, strongest first.
  const candidates: { p: number; g: number; overlap: number }[] = [];
  for (let p = 0; p < produced.length; p += 1) {
    for (let g = 0; g < expected.length; g += 1) {
      const overlap = intersectionSize(produced[p]!.files, expected[g]!.files);
      if (overlap > 0) {
        candidates.push({ p, g, overlap });
      }
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap);

  // Greedy one-to-one assignment.
  const usedProduced = new Set<number>();
  const usedExpected = new Set<number>();
  const matches: Match[] = [];
  for (const candidate of candidates) {
    if (usedProduced.has(candidate.p) || usedExpected.has(candidate.g)) {
      continue;
    }
    usedProduced.add(candidate.p);
    usedExpected.add(candidate.g);
    matches.push({ produced: produced[candidate.p]!.name, expected: expected[candidate.g]!.name, sharedFiles: candidate.overlap });
  }

  const falsePositives = produced.filter((_, index) => !usedProduced.has(index)).map((cap) => cap.name);
  const missed = expected.filter((_, index) => !usedExpected.has(index)).map((cap) => cap.name);

  // Citation precision: of all produced member files, how many are in-scope (appear
  // in some ground-truth capability)? Off-topic real files are still misleading.
  const allExpectedFiles = new Set<string>();
  for (const cap of expected) {
    for (const file of cap.files) {
      allExpectedFiles.add(file);
    }
  }
  let totalMembers = 0;
  let inScopeMembers = 0;
  for (const cap of produced) {
    for (const file of cap.files) {
      totalMembers += 1;
      if (allExpectedFiles.has(file)) {
        inScopeMembers += 1;
      }
    }
  }

  const precision = produced.length === 0 ? 0 : matches.length / produced.length;
  const recall = expected.length === 0 ? 0 : matches.length / expected.length;
  const citationPrecision = totalMembers === 0 ? 0 : inScopeMembers / totalMembers;

  const passPrecision = precision >= thresholds.precision;
  const passRecall = recall >= thresholds.recall;
  const passCitation = citationPrecision >= thresholds.citation;

  return {
    label: groundTruth.label,
    producedCount: produced.length,
    expectedCount: expected.length,
    matchedCount: matches.length,
    precision,
    recall,
    citationPrecision,
    matches,
    falsePositives,
    missed,
    pass: {
      precision: passPrecision,
      recall: passRecall,
      citation: passCitation,
      overall: passPrecision && passRecall && passCitation
    }
  };
}
