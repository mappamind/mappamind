// Score produced cross-service channels against hand-labeled truth (plan Phase 0).
//
// Four numbers the product lives on:
//   - precision / recall  — the usual, by service-pair + file match (never by name).
//   - candidate-stage recall — of true edges, how many the deterministic surfacer
//     even SURFACED. A channel the normalizer misses is invisible to the model: a
//     hard recall ceiling and the thin end of the catcher wedge (go-condition #2).
//   - poison-pill rate — of edges SHOWN AS "verified", the % that are wrong
//     (nonexistent, reversed direction, or wrong kind). This is the trust-critical
//     number (§I3); near-zero or the product is a confident liar.
// Plus a determinism check: identical code ⇒ identical claim set ⇒ churn 0 (§I5).
//
// Matching is by service-pair + cited file, NEVER by the model's wording, so a
// claim's prose cannot inflate the score (same discipline as the capability scorer).

import { channelClaimId } from "@mappamind_/core";

import type { ChannelGroundTruth } from "./channelTruth.js";

// What the pipeline produces, reduced to the fields scoring needs. Decoupled from
// seam's Channel/ChannelEdgeView on purpose (kept a plain string `kind`) so the
// scorer has no dependency on the recognition layer it grades.
export type ProducedChannelEdge = {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly direction: "from-calls-to" | "to-calls-from" | "bidirectional" | "unknown";
  readonly confidence: "verified" | "probable" | "possible";
  readonly producerFile: string;
  readonly consumerFile: string;
};

export type ChannelThresholds = {
  readonly precision: number;
  readonly recall: number;
  readonly poisonPill: number; // MAX allowed; default 0 — a verified edge must never be wrong
};

export const DEFAULT_CHANNEL_THRESHOLDS: ChannelThresholds = { precision: 0.8, recall: 0.5, poisonPill: 0 };

export type ChannelScoreReport = {
  readonly label: string;
  readonly producedCount: number;
  readonly expectedCount: number;
  readonly matchedCount: number;
  readonly precision: number;
  readonly recall: number;
  readonly candidateRecall: number | null; // null when no candidate set was supplied
  readonly verifiedCount: number;
  readonly poisonPillCount: number;
  readonly poisonPillRate: number;
  readonly wrongDirection: number;
  readonly wrongKind: number;
  readonly falseVerified: number; // verified edges with no truth match at all
  readonly missed: readonly string[]; // "from->to" of expected edges not produced
  readonly pass: {
    readonly precision: boolean;
    readonly recall: boolean;
    readonly poisonPill: boolean;
    readonly overall: boolean;
  };
};

function pairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

function sameKind(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// How strongly a produced edge matches a label: same unordered service pair, then
// counted by cited-file agreement (0..2). 0 file-agreement on a matching pair is
// still a weak match (1) so a real edge with imperfect file labels isn't lost.
function matchStrength(edge: ProducedChannelEdge, label: ChannelGroundTruth["edges"][number]): number {
  if (pairKey(edge.from, edge.to) !== pairKey(label.from, label.to)) return 0;
  const labelFiles = new Set([label.producerFile, label.consumerFile]);
  let files = 0;
  if (labelFiles.has(edge.producerFile)) files += 1;
  if (labelFiles.has(edge.consumerFile)) files += 1;
  return 1 + files; // 1 (pair only) .. 3 (pair + both files)
}

export function scoreChannels(
  produced: readonly ProducedChannelEdge[],
  groundTruth: ChannelGroundTruth,
  options: { readonly candidatePairs?: readonly string[]; readonly thresholds?: ChannelThresholds } = {}
): ChannelScoreReport {
  const thresholds = options.thresholds ?? DEFAULT_CHANNEL_THRESHOLDS;
  const expected = groundTruth.edges;

  // Greedy one-to-one assignment, strongest match first (mirrors the capability scorer).
  const candidates: { p: number; g: number; strength: number }[] = [];
  for (let p = 0; p < produced.length; p += 1) {
    for (let g = 0; g < expected.length; g += 1) {
      const strength = matchStrength(produced[p]!, expected[g]!);
      if (strength > 0) candidates.push({ p, g, strength });
    }
  }
  candidates.sort((a, b) => b.strength - a.strength);

  const usedP = new Set<number>();
  const usedG = new Set<number>();
  const matchOf = new Map<number, number>(); // produced index -> expected index
  for (const c of candidates) {
    if (usedP.has(c.p) || usedG.has(c.g)) continue;
    usedP.add(c.p);
    usedG.add(c.g);
    matchOf.set(c.p, c.g);
  }

  const matchedCount = matchOf.size;
  const precision = produced.length === 0 ? 0 : matchedCount / produced.length;
  const recall = expected.length === 0 ? 0 : matchedCount / expected.length;

  // Poison pills: only ever assessed on edges the product SHOWS as verified.
  let verifiedCount = 0;
  let wrongDirection = 0;
  let wrongKind = 0;
  let falseVerified = 0;
  for (let p = 0; p < produced.length; p += 1) {
    const edge = produced[p]!;
    if (edge.confidence !== "verified") continue;
    verifiedCount += 1;
    const g = matchOf.get(p);
    if (g === undefined) {
      falseVerified += 1; // verified edge with no truth match — the worst case
      continue;
    }
    const label = expected[g]!;
    // Direction is wrong unless the produced from->to matches the label, or the
    // claim is explicitly bidirectional (a superset, not a lie).
    const directionRight = edge.direction === "bidirectional" || (edge.from === label.from && edge.to === label.to);
    if (!directionRight) wrongDirection += 1;
    if (edge.kind !== "unknown" && !sameKind(edge.kind, label.kind)) wrongKind += 1;
  }
  // A verified edge is poisoned if it is false, reversed, OR wrong-kind (count it once).
  const poisonPillCount = falseVerified + wrongDirection + wrongKind;
  const poisonPillRate = verifiedCount === 0 ? 0 : poisonPillCount / verifiedCount;

  let candidateRecall: number | null = null;
  if (options.candidatePairs) {
    const set = new Set(options.candidatePairs.map((pair) => pair));
    const covered = expected.filter((e) => set.has(pairKey(e.from, e.to))).length;
    candidateRecall = expected.length === 0 ? 0 : covered / expected.length;
  }

  const missed = expected
    .filter((_, g) => !usedG.has(g))
    .map((e) => `${e.from}->${e.to}`);

  const passPrecision = precision >= thresholds.precision;
  const passRecall = recall >= thresholds.recall;
  const passPoison = poisonPillRate <= thresholds.poisonPill;

  return {
    label: groundTruth.label,
    producedCount: produced.length,
    expectedCount: expected.length,
    matchedCount,
    precision,
    recall,
    candidateRecall,
    verifiedCount,
    poisonPillCount,
    poisonPillRate,
    wrongDirection,
    wrongKind,
    falseVerified,
    missed,
    pass: {
      precision: passPrecision,
      recall: passRecall,
      poisonPill: passPoison,
      overall: passPrecision && passRecall && passPoison
    }
  };
}

// Determinism (§I5): the same code must yield the same claim set across runs. A
// claim's identity is content-addressed (channel key + endpoints), independent of
// file position, so churn is the true set-delta — not model mood.
export type ChurnReport = {
  readonly churn: number;
  readonly added: readonly string[];
  readonly removed: readonly string[];
};

function edgeClaimId(edge: ProducedChannelEdge): string {
  // No normalized route key at this layer, so derive a stable key from the cited
  // evidence + kind. Two runs over identical code hash identically.
  return channelClaimId(`${edge.kind}|${edge.producerFile}|${edge.consumerFile}`, edge.from, edge.to);
}

export function claimSetChurn(
  runA: readonly ProducedChannelEdge[],
  runB: readonly ProducedChannelEdge[]
): ChurnReport {
  const a = new Set(runA.map(edgeClaimId));
  const b = new Set(runB.map(edgeClaimId));
  const added = [...b].filter((id) => !a.has(id));
  const removed = [...a].filter((id) => !b.has(id));
  return { churn: added.length + removed.length, added, removed };
}
