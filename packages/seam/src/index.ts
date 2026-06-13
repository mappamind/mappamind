export { detectSeams, DEFAULT_CONVENTIONS } from "./detect.js";
export { buildServiceGraph } from "./serviceArchitecture.js";
export { detectServiceBoundaries, serviceOf, isServiceBearingFile } from "./serviceBoundary.js";
export type { ServiceBoundaries } from "./serviceBoundary.js";
export { surfaceChannelCandidates, normKey } from "./channelCandidates.js";
export type { SurfaceOptions } from "./channelCandidates.js";
export { isContractFile, contractKeyAnchors } from "./contractAnchors.js";
export type { ContractAnchor } from "./contractAnchors.js";
export {
  verifyChannel,
  verifyChannels,
  indexAnchors,
  channelId,
  candidateAnchorHash,
  channelAnchorHash,
  partitionByCache,
  channelEdgeViews
} from "./verifyChannel.js";
export type { AnchorIndex } from "./verifyChannel.js";
export * from "./channel.js";
export type { ServiceGraph, ServiceEdge, DanglingContract } from "./serviceArchitecture.js";
export type { SeamConvention } from "./conventions.js";
export type {
  Confidence,
  Occurrence,
  OccurrenceKind,
  RepoFacts,
  SeamContract,
  SeamReport,
  SeamSide,
  SeamStatus
} from "./types.js";
