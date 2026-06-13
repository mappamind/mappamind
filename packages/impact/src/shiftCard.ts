// The ShiftCard: the deterministic skeleton of the accept-moment card.
//
// Division of labor (the leash, applied to narration): the FLOOR decides
// everything checkable — severity, which contracts broke, which breaks are
// provably internal, the changed summary, the impacted capability list. The
// MODEL writes only the title and the 2-3 sentence narration, and judges only
// the danglings the floor cannot prove (external-SDK adoption vs unknown).
// A model answer can never upgrade, downgrade, or invent a fact on the card.

import type { DanglingContract, ServiceEdge } from "@mappamind_/seam";

import type { ChannelChange } from "./channelDiff.js";
import type { MeshDiff } from "./meshDiff.js";
import type { ImpactSlice } from "./types.js";

export type DanglingKind = "internal-break" | "external-service" | "unknown";

export type BrokenContract = {
  readonly service: string; // the consumer left calling a missing provider
  readonly contract: string;
  readonly file: string;
  readonly line: number;
  readonly kind: DanglingKind;
  // Honest provenance: "deterministic" = the floor proved it (a lost edge or a
  // removed service backs it); "model" = the leashed narrator judged it.
  readonly kindSource: "deterministic" | "model";
};

export type ShiftSeverity = "cosmetic" | "local" | "broad";

export type ShiftCard = {
  readonly title: string;
  readonly changedSummary: string;
  readonly narration: string;
  readonly narrationSource: "model" | "deterministic"; // fallback is never hidden
  readonly severity: ShiftSeverity;
  readonly baselineStale: boolean; // capability names may be outdated (honesty bit)
  readonly impactedCapabilities: readonly string[];
  readonly brokenContracts: readonly BrokenContract[];
  // The verified channel deltas this session caused — the card's hero. Each carries
  // the cited producer/consumer anchors rendered inline as the proof (§I3).
  readonly channelChanges: readonly ChannelChange[];
};

// Mirror of the seam's contract-key normalization (serviceArchitecture.ts),
// kept tiny and local: lowercase alphanumerics, trailing "service" and plural
// "s" dropped, so "src/shippingservice" keys to "shipping".
function keyOf(raw: string): string {
  const last = raw.split("/").filter(Boolean).pop() ?? raw;
  return last
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/service$/, "")
    .replace(/s$/, "");
}

// Classify each new dangling. Provable internal-break: its contract matches a
// lost edge's contract or a removed service — the provider existed before this
// session and is gone now. Everything else stays "unknown" until the narrator
// judges it (external-service | unknown); it can never become less than that.
export function classifyBrokenContracts(diff: MeshDiff): BrokenContract[] {
  const lostContracts = new Set(diff.lostEdges.map((edge: ServiceEdge) => edge.contract));
  const removedKeys = new Set(diff.removedServices.map(keyOf));
  return diff.brokenContracts.map((dangling: DanglingContract) => {
    const provableInternal = lostContracts.has(dangling.contract) || removedKeys.has(dangling.contract);
    return {
      service: dangling.service,
      contract: dangling.contract,
      file: dangling.file,
      line: dangling.line,
      kind: provableInternal ? "internal-break" : "unknown",
      kindSource: "deterministic"
    } as const;
  });
}

// Deterministic severity. Red is earned, never guessed:
//   cosmetic — nothing downstream at all (folds; the card is not shown)
//   broad    — a real or unresolved break, structural loss, or cross-service /
//              multi-capability reach
//   local    — contained ripple (incl. a pure external-SDK adoption)
// An "external-service" dangling alone does NOT make a session broad — that is
// the false-alarm fix; an "unknown" one DOES (cautious by default).
export function computeSeverity(
  slice: ImpactSlice,
  brokenContracts: readonly BrokenContract[],
  diff?: MeshDiff
): ShiftSeverity {
  const structuralLoss =
    diff !== undefined && (diff.lostEdges.length > 0 || diff.removedServices.length > 0);
  const alarmingBreak = brokenContracts.some((contract) => contract.kind !== "external-service");

  if (
    slice.cosmetic &&
    brokenContracts.length === 0 &&
    !structuralLoss
  ) {
    return "cosmetic";
  }
  if (
    alarmingBreak ||
    structuralLoss ||
    slice.atRiskServiceEdges.length > 0 ||
    slice.atRiskContracts.length > 0 ||
    slice.affectedCapabilities.length >= 2
  ) {
    return "broad";
  }
  return "local";
}

// A factual one-liner when the caller has nothing better (e.g. no git stat).
export function buildChangedSummary(slice: ImpactSlice): string {
  const parts = [`${slice.changedPaths.length} file${slice.changedPaths.length === 1 ? "" : "s"} changed`];
  if (slice.unknownPaths.length > 0) {
    parts.push(`${slice.unknownPaths.length} non-code`);
  }
  if (slice.affectedFiles.length > 0) {
    parts.push(`${slice.affectedFiles.length} dependent${slice.affectedFiles.length === 1 ? "" : "s"} affected`);
  }
  return parts.join(", ");
}

// The deterministic narration: composed only from facts already on the card,
// so it is grounded by construction. Used when the slice is cosmetic (no model
// call at all), when the model is unavailable, or when its answer failed the
// leash twice. Honest, plain, never wrong.
export function buildFallbackNarration(
  slice: ImpactSlice,
  brokenContracts: readonly BrokenContract[]
): string {
  const internal = brokenContracts.filter((contract) => contract.kind === "internal-break");
  const unknown = brokenContracts.filter((contract) => contract.kind === "unknown");
  const external = brokenContracts.filter((contract) => contract.kind === "external-service");
  const sentences: string[] = [];

  for (const broken of internal) {
    sentences.push(
      `${broken.service} still calls [${broken.contract}] (${broken.file}:${broken.line}) but its provider is gone.`
    );
  }
  for (const broken of unknown) {
    sentences.push(
      `${broken.service} now calls [${broken.contract}] (${broken.file}:${broken.line}), which no service in the workspace provides.`
    );
  }
  if (external.length > 0) {
    sentences.push(
      `New external service dependenc${external.length === 1 ? "y" : "ies"}: ${external.map((b) => b.contract).join(", ")}.`
    );
  }
  if (slice.atRiskServiceEdges.length > 0) {
    const consumers = [...new Set(slice.atRiskServiceEdges.map((edge) => edge.consumer))];
    sentences.push(`A changed provider is called by ${consumers.join(", ")}.`);
  }
  if (slice.affectedFiles.length > 0) {
    const capabilityPart =
      slice.affectedCapabilities.length > 0
        ? ` across ${slice.affectedCapabilities.map((capability) => capability.name).join(", ")}`
        : "";
    sentences.push(`${slice.affectedFiles.length} file${slice.affectedFiles.length === 1 ? "" : "s"}${capabilityPart} depend on what changed.`);
  }
  if (sentences.length === 0) {
    sentences.push("Nothing downstream was affected.");
  }
  return sentences.join(" ");
}

export function buildFallbackTitle(
  severity: ShiftSeverity,
  brokenContracts: readonly BrokenContract[],
  slice: ImpactSlice
): string {
  const alarming = brokenContracts.filter((contract) => contract.kind !== "external-service");
  if (alarming.length > 0) {
    return `This session broke ${alarming.length} contract${alarming.length === 1 ? "" : "s"}`;
  }
  if (severity === "cosmetic") {
    return "No downstream impact";
  }
  if (slice.affectedFiles.length > 0) {
    return `${slice.affectedFiles.length} file${slice.affectedFiles.length === 1 ? "" : "s"} depend on this change`;
  }
  return "Change with cross-service reach";
}
