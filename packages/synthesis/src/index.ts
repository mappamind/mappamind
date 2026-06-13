export { synthesizeBaseline } from "./synthesize.js";
export type { SynthesisInput, SynthesisResult, RepoError } from "./synthesize.js";
export { createClaudeCliClient } from "./claudeClient.js";
export type { ClaudeCliOptions } from "./claudeClient.js";
export { createCodexCliClient, extractAgentMessage } from "./codexClient.js";
export type { CodexCliOptions } from "./codexClient.js";
export { selectModelClient, resolveModelHost } from "./selectModelClient.js";
export type { SelectModelOptions, ModelHost } from "./selectModelClient.js";
export type { ModelClient, ModelRequest, ModelResponse, ModelCallLog } from "./model.js";
export { parseProposal, extractJsonObject } from "./parse.js";
export { SYNTHESIS_SYSTEM, buildRepoPrompt, buildRepoInventory } from "./prompt.js";
export { adjudicateChannels, rankByTranscript } from "./adjudicateChannels.js";
export type { AdjudicateInput, AdjudicationResult } from "./adjudicateChannels.js";
export {
  CHANNEL_SYSTEM,
  CHANNEL_REDTEAM_SYSTEM,
  buildChannelPrompt,
  buildRedTeamPrompt,
  candidateToPrompt
} from "./channelPrompt.js";
export type { PromptCandidate, PromptEndpoint } from "./channelPrompt.js";
