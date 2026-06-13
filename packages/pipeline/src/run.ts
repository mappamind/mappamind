// The composition root: repo paths -> a grounded, persisted baseline.
//
// assembleBaseline is the pure-ish core (facts in, baseline out + optional persist),
// testable with a fake model. collectAndBuild adds the real capture/extract front
// end. The model is injected, so the same path runs on `claude -p` or an API model.

import { buildWorkspaceModel } from "@mappamind_/baseline";
import type { RepoFiles, WorkspaceModel } from "@mappamind_/baseline";
import { detectSeams } from "@mappamind_/seam";
import type { SeamReport, ServiceGraph } from "@mappamind_/seam";
import { synthesizeBaseline } from "@mappamind_/synthesis";
import type { ModelClient, SynthesisResult } from "@mappamind_/synthesis";
import { factsHashFor, workspaceIdFor, writeBaseline } from "@mappamind_/store";

import { collectRepoFacts, qualifyRepoFiles } from "./collect.js";
import { writeChannelCache } from "./channelStore.js";
import { buildServiceMesh } from "./mesh.js";
import type { CollectSummary } from "./collect.js";

export type AssembleInput = {
  readonly repos: readonly RepoFiles[];
  readonly client: ModelClient;
  readonly workspaceId: string;
  readonly persist?: boolean; // default true
  readonly env?: NodeJS.ProcessEnv;
};

export type AssembleResult = {
  readonly workspaceId: string;
  readonly model: WorkspaceModel;
  readonly synthesis: SynthesisResult;
  readonly storePath?: string; // set when persisted
};

export async function assembleBaseline(input: AssembleInput): Promise<AssembleResult> {
  const model = buildWorkspaceModel(input.repos);
  const factsHash = factsHashFor(input.repos);
  const synthesis = await synthesizeBaseline({
    repos: input.repos,
    client: input.client,
    workspaceId: input.workspaceId,
    factsHash,
    model
  });

  let storePath: string | undefined;
  if (input.persist !== false) {
    storePath = await writeBaseline(input.workspaceId, synthesis.baseline, input.env ?? process.env);
  }

  return { workspaceId: input.workspaceId, model, synthesis, ...(storePath ? { storePath } : {}) };
}

export type RepoSpec = {
  readonly repo: string; // label
  readonly root: string; // absolute path on disk
};

export type CollectAndBuildInput = {
  readonly repos: readonly RepoSpec[];
  readonly client: ModelClient;
  readonly persist?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly qualifyPaths?: boolean;
  readonly progress?: (message: string) => void;
};

export type CollectAndBuildResult = AssembleResult & {
  readonly collected: readonly CollectSummary[];
  readonly architecture: ServiceGraph; // the cross-service mesh (deterministic)
  readonly seams: SeamReport; // cross-boundary contracts (deterministic)
};

export async function collectAndBuild(input: CollectAndBuildInput): Promise<CollectAndBuildResult> {
  const collected: CollectSummary[] = [];
  const repoFiles: RepoFiles[] = [];
  const qualify = input.qualifyPaths ?? input.repos.length > 1;
  for (const spec of input.repos) {
    input.progress?.(`Capturing files in ${spec.repo}...`);
    const { repoFiles: facts, summary } = await collectRepoFacts(spec.repo, spec.root);
    repoFiles.push(qualify ? qualifyRepoFiles(facts) : facts);
    collected.push(summary);
  }

  input.progress?.("Building the structural model...");
  // The service mesh + contracts span the whole workspace. Edges come from the
  // claim→verify channel pipeline (model recognition behind the verifier), not a
  // naming catcher. The verified channels become the next run's cache.
  const mesh = await buildServiceMesh({
    files: repoFiles.flatMap((repo) => repo.files),
    client: input.client
  });
  const architecture = mesh.graph;
  const seams = detectSeams(repoFiles);

  const workspaceId = workspaceIdFor(input.repos.map((spec) => spec.root));
  input.progress?.("Synthesizing grounded capabilities...");
  const assembled = await assembleBaseline({
    repos: repoFiles,
    client: input.client,
    workspaceId,
    ...(input.persist !== undefined ? { persist: input.persist } : {}),
    ...(input.env ? { env: input.env } : {})
  });

  // Persist the verified channels so the next shift's before-mesh reuses them (I7).
  if (input.persist !== false) await writeChannelCache(workspaceId, mesh.cache, input.env ?? process.env);

  return { ...assembled, collected, architecture, seams };
}
