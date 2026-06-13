import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { RepoFiles } from "@mappamind_/baseline";
import { detectSeams } from "@mappamind_/seam";
import { baselinePath, loadBaselineStatus, workspaceIdFor, writeBaseline } from "@mappamind_/store";
import type { ModelClient, RepoError } from "@mappamind_/synthesis";

import { collectRepoFacts, qualifyRepoFiles } from "./collect.js";
import type { CollectSummary } from "./collect.js";
import { writeChannelCache } from "./channelStore.js";
import { buildServiceMesh } from "./mesh.js";
import { isMappamindHook, type HookKind } from "./hookConfig.js";
import { fileUrlForPath, readShiftHistory } from "./shift.js";
import { renderAppHtml } from "./renderApp.js";
import { assembleBaseline } from "./run.js";
import { workspaceStateEnv } from "./localStore.js";
import { resolveWorkspace, type ResolvedWorkspace } from "./workspace.js";

// The real version comes from this package's own package.json — scripts/publish.mjs
// rewrites it on tag, so a published build reports its true version instead of a
// frozen constant. (In-tree dev it reads 0.0.0, which is correct: unpublished.)
export const MAPPAMIND_CLI_VERSION: string =
  (createRequire(import.meta.url)("../package.json") as { version?: string }).version ?? "0.0.0";

export type BaselineState = "missing" | "current" | "stale";

export type ProgressReporter = (message: string) => void;

export type StatusRepo = {
  readonly repo: string;
  readonly root: string;
};

export type HookStatus = {
  readonly claudeProjectHooks: boolean;
  readonly codexProjectHooks: boolean;
  readonly warnings: readonly string[];
};

export type MappamindStatus = {
  readonly version: string;
  readonly root: string;
  readonly workspaceId: string;
  readonly isWorkspace: boolean;
  readonly repos: readonly StatusRepo[];
  readonly filesSeen: number;
  readonly filesExtracted: number;
  readonly baseline: {
    readonly state: BaselineState;
    readonly path: string;
    readonly factsHash: string;
    readonly warning?: string;
    readonly studioPath?: string;
    readonly studioUrl?: string;
  };
  readonly hooks: HookStatus;
};

export type SetupOutcome = {
  readonly ran: boolean;
  readonly reason: "missing" | "stale" | "current" | "not-approved";
  readonly status: MappamindStatus;
  readonly synthesis?: SetupSynthesisSummary;
  readonly baselinePath?: string;
  readonly channelCachePath?: string;
  readonly studioPath?: string;
  readonly studioUrl?: string;
};

export type SetupSynthesisSummary = {
  readonly modelAttempts: number;
  readonly modelCalls: number;
  readonly capabilities: number;
  readonly droppedCapabilities: number;
  readonly droppedEdges: number;
  readonly repoErrors: readonly RepoError[];
};

type WorkspaceFacts = {
  readonly repoFiles: readonly RepoFiles[];
  readonly collected: readonly CollectSummary[];
};

// The single-page app is the Studio. Status still recognizes the legacy
// baseline/latest.html path below for users who generated it with older builds.
function appPathForRoot(root: string): string {
  return join(root, ".mappamind", "index.html");
}
function legacyStudioPathForRoot(root: string): string {
  return join(root, ".mappamind", "baseline", "latest.html");
}

// Reuses the shared hookConfig matcher (subcommand-aware) so status detection
// can't drift from what install/remove consider a Mappamind hook.
function entriesHaveMappamindCommand(entries: unknown, sub: HookKind): boolean {
  return Array.isArray(entries) && entries.some((entry) => {
    if (typeof entry !== "object" || entry === null || !Array.isArray((entry as { hooks?: unknown }).hooks)) {
      return false;
    }
    return (entry as { hooks: unknown[] }).hooks.some((hook) => isMappamindHook(hook, sub));
  });
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function inspectHooks(root: string): Promise<HookStatus> {
  const claude = await readJsonObject(join(root, ".claude", "settings.json"));
  const codex = await readJsonObject(join(root, ".codex", "hooks.json"));
  const claudeHooks = (claude["hooks"] ?? {}) as Record<string, unknown>;
  const codexHooks = (codex["hooks"] ?? {}) as Record<string, unknown>;
  const claudeProjectHooks =
    entriesHaveMappamindCommand(claudeHooks["SessionStart"], "snapshot") ||
    entriesHaveMappamindCommand(claudeHooks["Stop"], "shift");
  const codexProjectHooks =
    entriesHaveMappamindCommand(codexHooks["SessionStart"], "snapshot") ||
    entriesHaveMappamindCommand(codexHooks["Stop"], "shift");
  const warnings: string[] = [];
  if (codexProjectHooks) {
    warnings.push("Codex project hooks are installed; if the Codex plugin is enabled, remove them with `mappamind hooks --remove --agent codex`.");
  }
  return { claudeProjectHooks, codexProjectHooks, warnings };
}

async function collectWorkspaceFacts(
  workspace: ResolvedWorkspace,
  progress?: ProgressReporter
): Promise<WorkspaceFacts> {
  const repoFiles: RepoFiles[] = [];
  const collected: CollectSummary[] = [];
  const qualify = workspace.isWorkspace;
  for (const spec of workspace.repos) {
    progress?.(`Capturing files in ${spec.repo}...`);
    const facts = await collectRepoFacts(spec.repo, spec.root);
    repoFiles.push(qualify ? qualifyRepoFiles(facts.repoFiles) : facts.repoFiles);
    collected.push(facts.summary);
  }
  return { repoFiles, collected };
}

async function statusFromFacts(args: {
  readonly workspace: ResolvedWorkspace;
  readonly facts: WorkspaceFacts;
  readonly env: NodeJS.ProcessEnv;
}): Promise<MappamindStatus> {
  const workspaceId = workspaceIdFor(args.workspace.repos.map((repo) => repo.root));
  const baselineStatus = await loadBaselineStatus(workspaceId, args.facts.repoFiles, args.env);
  const state: BaselineState = baselineStatus.baseline === null ? "missing" : baselineStatus.stale ? "stale" : "current";
  const staleWarning =
    state === "stale"
      ? "Stored baseline no longer matches current structural facts. This can happen after structural edits or checking out another branch; shift cards still compare session start to session end. Run setup when you want this branch/worktree to become the standing baseline."
      : undefined;
  const appPath = appPathForRoot(args.workspace.root);
  const legacyPath = legacyStudioPathForRoot(args.workspace.root);
  const studioPath = existsSync(appPath) ? appPath : existsSync(legacyPath) ? legacyPath : undefined;
  const hooks = await inspectHooks(args.workspace.root);
  const totals = args.facts.collected.reduce(
    (acc, summary) => ({
      filesSeen: acc.filesSeen + summary.filesSeen,
      filesExtracted: acc.filesExtracted + summary.filesExtracted
    }),
    { filesSeen: 0, filesExtracted: 0 }
  );
  return {
    version: MAPPAMIND_CLI_VERSION,
    root: args.workspace.root,
    workspaceId,
    isWorkspace: args.workspace.isWorkspace,
    repos: args.workspace.repos.map((repo) => ({ repo: repo.repo, root: repo.root })),
    filesSeen: totals.filesSeen,
    filesExtracted: totals.filesExtracted,
    baseline: {
      state,
      path: baselinePath(workspaceId, args.env),
      factsHash: baselineStatus.currentFactsHash,
      ...(staleWarning ? { warning: staleWarning } : {}),
      ...(studioPath ? { studioPath, studioUrl: fileUrlForPath(studioPath) } : {})
    },
    hooks
  };
}

export async function getMappamindStatus(args: {
  readonly root: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly progress?: ProgressReporter;
}): Promise<MappamindStatus> {
  const rawEnv = args.env ?? process.env;
  args.progress?.("Discovering repos...");
  const workspace = await resolveWorkspace(args.root);
  const env = workspaceStateEnv(workspace.root, rawEnv);
  const facts = await collectWorkspaceFacts(workspace, args.progress);
  args.progress?.("Checking stored baseline...");
  return statusFromFacts({ workspace, facts, env });
}

export async function runSetup(args: {
  readonly root: string;
  readonly client: ModelClient;
  readonly env?: NodeJS.ProcessEnv;
  readonly force?: boolean;
  readonly assumeYes?: boolean;
  readonly confirm?: (status: MappamindStatus) => Promise<boolean>;
  readonly progress?: ProgressReporter;
}): Promise<SetupOutcome> {
  const rawEnv = args.env ?? process.env;
  args.progress?.("Discovering repos...");
  const workspace = await resolveWorkspace(args.root);
  const env = workspaceStateEnv(workspace.root, rawEnv);
  const workspaceId = workspaceIdFor(workspace.repos.map((repo) => repo.root));
  const facts = await collectWorkspaceFacts(workspace, args.progress);
  args.progress?.("Checking stored baseline...");
  const status = await statusFromFacts({ workspace, facts, env });
  const reason = status.baseline.state;

  if (reason === "current" && !args.force) {
    return {
      ran: false,
      reason: "current",
      status,
      ...(status.baseline.studioPath ? { studioPath: status.baseline.studioPath, studioUrl: status.baseline.studioUrl } : {})
    };
  }

  if (!args.assumeYes) {
    const approved = args.confirm ? await args.confirm(status) : false;
    if (!approved) {
      return { ran: false, reason: "not-approved", status };
    }
  }

  args.progress?.("Building the structural model...");
  const mesh = await buildServiceMesh({
    files: facts.repoFiles.flatMap((repo) => repo.files),
    client: args.client
  });
  const architecture = mesh.graph;
  const channels = mesh.channels;
  args.progress?.("Synthesizing grounded capabilities...");
  const assembled = await assembleBaseline({
    repos: facts.repoFiles,
    client: args.client,
    workspaceId,
    env,
    persist: false
  });
  const synthesis: SetupSynthesisSummary = {
    modelAttempts: facts.repoFiles.length,
    modelCalls: assembled.synthesis.calls.length,
    capabilities: assembled.synthesis.baseline.capabilities.length,
    droppedCapabilities: assembled.synthesis.droppedCapabilities.length,
    droppedEdges: assembled.synthesis.droppedEdges.length,
    repoErrors: assembled.synthesis.repoErrors
  };
  if (synthesis.capabilities === 0 && synthesis.repoErrors.length === facts.repoFiles.length) {
    throw new Error(
      "Model-backed synthesis failed for every repo; no baseline was written. " +
        synthesis.repoErrors.map((error) => `${error.repo}: ${error.error}`).join("; ")
    );
  }

  args.progress?.("Writing Studio...");
  const storedBaselinePath = await writeBaseline(workspaceId, assembled.synthesis.baseline, env);
  const channelCachePath = await writeChannelCache(workspaceId, mesh.cache, env);
  const title = workspace.repos.map((repo) => repo.repo).join(" + ");
  const seams = detectSeams(facts.repoFiles);
  const history = await readShiftHistory(workspaceId, env);
  const html = renderAppHtml({ title, baseline: assembled.synthesis.baseline, architecture, seams, channels, history });
  const studioPath = appPathForRoot(workspace.root);
  await mkdir(dirname(studioPath), { recursive: true });
  await writeFile(studioPath, html, "utf8");

  const nextStatus: MappamindStatus = {
    ...status,
    baseline: {
      ...status.baseline,
      state: "current",
      studioPath,
      studioUrl: fileUrlForPath(studioPath)
    }
  };

  return {
    ran: true,
    reason: reason === "current" ? "current" : reason,
    status: nextStatus,
    synthesis,
    baselinePath: storedBaselinePath,
    channelCachePath,
    studioPath,
    studioUrl: fileUrlForPath(studioPath)
  };
}
