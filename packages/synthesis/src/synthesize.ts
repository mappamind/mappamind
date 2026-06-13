// The synthesis orchestrator (M3b, Point 3).
//
// Chunked by repo: each repo is mapped on its own (no whole-workspace megaprompt),
// the untrusted proposals are merged, then the leash (groundBaseline) admits only
// what the facts support. The model is injected, so this is identical whether it
// runs on `claude -p` or a pinned API model. Model failures and unparseable
// responses are recorded, never fatal — a bad repo yields nothing, not a fabrication.
//
// Follow-up: a cross-repo JOIN pass (merge capabilities that span repos, propose
// seam-backed edges) lands when M2's SeamReport is wired in. Today's edges are the
// within-repo dependency-backed ones the leash can verify.

import { buildWorkspaceModel, groundBaseline } from "@mappamind_/baseline";
import type {
  Baseline,
  DroppedCapability,
  DroppedEdge,
  ProposedCapability,
  ProposedEdge,
  ProposedUnknown,
  RepoFiles,
  WorkspaceModel
} from "@mappamind_/baseline";

import type { ModelCallLog, ModelClient } from "./model.js";
import { parseProposal } from "./parse.js";
import { SYNTHESIS_SYSTEM, buildRepoPrompt } from "./prompt.js";

export type SynthesisInput = {
  readonly repos: readonly RepoFiles[];
  readonly client: ModelClient;
  readonly workspaceId: string;
  readonly factsHash: string;
  readonly model?: WorkspaceModel; // reuse a precomputed model; else built here
};

export type RepoError = {
  readonly repo: string;
  readonly error: string;
};

export type SynthesisResult = {
  readonly baseline: Baseline;
  readonly droppedCapabilities: readonly DroppedCapability[];
  readonly droppedEdges: readonly DroppedEdge[];
  readonly calls: readonly ModelCallLog[]; // for the ledger
  readonly repoErrors: readonly RepoError[];
};

export async function synthesizeBaseline(input: SynthesisInput): Promise<SynthesisResult> {
  const model = input.model ?? buildWorkspaceModel(input.repos);
  const calls: ModelCallLog[] = [];
  const repoErrors: RepoError[] = [];
  const capabilities: ProposedCapability[] = [];
  const edges: ProposedEdge[] = [];
  const unknowns: ProposedUnknown[] = [];

  for (const repo of input.repos) {
    const prompt = buildRepoPrompt(repo);
    let responseText: string;
    try {
      const response = await input.client.complete({ system: SYNTHESIS_SYSTEM, prompt });
      responseText = response.text;
    } catch (error) {
      repoErrors.push({ repo: repo.repo, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    calls.push({ label: `synthesize:${repo.repo}`, system: SYNTHESIS_SYSTEM, prompt, response: responseText });

    try {
      const proposal = parseProposal(responseText);
      capabilities.push(...proposal.capabilities);
      edges.push(...proposal.edges);
      unknowns.push(...proposal.unknowns);
    } catch (error) {
      repoErrors.push({ repo: repo.repo, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const grounded = groundBaseline(
    { capabilities, edges, unknowns },
    input.repos,
    model,
    input.workspaceId,
    input.factsHash
  );

  return { ...grounded, calls, repoErrors };
}
