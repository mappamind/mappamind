export { buildReverseIndex } from "./reverseIndex.js";
export type { ReverseIndex } from "./reverseIndex.js";
export { computeBlastRadius } from "./blastRadius.js";
export type { BlastRadiusInput } from "./blastRadius.js";
export { diffServiceGraphs } from "./meshDiff.js";
export type { MeshDiff } from "./meshDiff.js";
export { diffChannels } from "./channelDiff.js";
export type { ChannelChange } from "./channelDiff.js";
export { narrateShift, auditNarration } from "./narrateShift.js";
export type { NarrateShiftInput } from "./narrateShift.js";
export {
  buildChangedSummary,
  buildFallbackNarration,
  buildFallbackTitle,
  classifyBrokenContracts,
  computeSeverity
} from "./shiftCard.js";
export type { BrokenContract, DanglingKind, ShiftCard, ShiftSeverity } from "./shiftCard.js";
export type {
  AffectedCapability,
  AffectedFile,
  AtRiskContract,
  AtRiskServiceEdge,
  ImpactSlice
} from "./types.js";
