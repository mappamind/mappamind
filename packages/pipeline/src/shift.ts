// The accept-moment engine (Phase 2d): the thin runner behind the hooks.
//
//   SessionStart  -> takeSnapshot(root)   — record the BEFORE (facts + hashes)
//   Stop          -> runShift(root)       — diff, blast radius, narrate, render
//
// The "before" source (PLAN concern #3): primary is the SessionStart snapshot;
// when none exists the pre-session tree is re-extracted from `git archive HEAD`
// (an agent's uncommitted work diffs against HEAD). Durable Mappamind memory
// lives under <root>/.mappamind/state by default; rendered cards live beside it
// under <root>/.mappamind/shift/.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { Baseline, RepoFiles, WorkspaceModel } from "@mappamind_/baseline";
import { buildWorkspaceModel } from "@mappamind_/baseline";
import {
  computeBlastRadius,
  diffChannels,
  diffServiceGraphs,
  narrateShift
} from "@mappamind_/impact";
import type { ImpactSlice, MeshDiff, ShiftCard } from "@mappamind_/impact";
import { appendJsonLine } from "@mappamind_/ledger";
import { detectSeams } from "@mappamind_/seam";
import type { ServiceGraph } from "@mappamind_/seam";
import { loadBaselineStatus, workspaceDir, workspaceIdFor } from "@mappamind_/store";
import type { ModelClient, ModelRequest, ModelResponse } from "@mappamind_/synthesis";

import { collectRepoFacts, qualifyFileHashes, qualifyRepoFiles } from "./collect.js";
import { readChannelCache } from "./channelStore.js";
import { buildServiceMesh } from "./mesh.js";
import { workspaceStateEnv } from "./localStore.js";
import { renderAppHtml, type ShiftHistoryEntry } from "./renderApp.js";
import { renderShiftCardHtml } from "./renderShiftCard.js";
import type { RepoSpec } from "./run.js";
import { resolveWorkspace, type ResolvedWorkspace } from "./workspace.js";

const MAX_ARCHIVED_CARDS = 50;

// The shift ledger as history rows for the app's Shifts tab (newest survives
// pruning of the HTML; the ledger itself is append-only and complete).
export async function readShiftHistory(
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<readonly ShiftHistoryEntry[]> {
  try {
    const raw = await readFile(join(workspaceDir(workspaceId, env), "shifts.jsonl"), "utf8");
    const rows: ShiftHistoryEntry[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line) as Partial<ShiftHistoryEntry>;
        if (typeof r.at !== "string" || typeof r.title !== "string") continue;
        rows.push({
          at: r.at,
          severity: r.severity ?? "local",
          title: r.title,
          changedFiles: r.changedFiles ?? 0,
          affectedFiles: r.affectedFiles ?? 0,
          brokenContracts: r.brokenContracts ?? 0,
          ...(r.cardFile ? { cardFile: r.cardFile } : {})
        });
      } catch {
        // a malformed line is skipped, never fatal
      }
    }
    return rows;
  } catch {
    return [];
  }
}

// Keep the newest N archived cards; the ledger keeps the full history.
async function pruneArchivedCards(shiftDir: string, keep: number): Promise<void> {
  try {
    const entries = await readdir(shiftDir);
    const archived = entries
      .filter((name) => name.endsWith(".html") && name !== "latest.html")
      .sort(); // ISO-derived names sort chronologically
    const stale = archived.slice(0, Math.max(0, archived.length - keep));
    await Promise.all(stale.map((name) => rm(join(shiftDir, name), { force: true })));
  } catch {
    // pruning is best-effort; never fail a shift over housekeeping
  }
}

const run = promisify(execFile);

export function fileUrlForPath(path: string): string {
  return pathToFileURL(resolve(path)).href;
}

export type CardOpener = (command: string, args: readonly string[]) => Promise<unknown>;

export type OpenShiftCardOptions = {
  readonly htmlPath: string;
  readonly quiet?: boolean;
  readonly forceOpen?: boolean;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly opener?: CardOpener;
};

export async function maybeOpenShiftCard(options: OpenShiftCardOptions): Promise<boolean> {
  const env = options.env ?? process.env;
  if (env["MAPPAMIND_OPEN"] === "0" || (options.quiet && !options.forceOpen)) {
    return false;
  }

  const url = fileUrlForPath(options.htmlPath);
  const platform = options.platform ?? process.platform;
  const opener: CardOpener =
    options.opener ?? ((command, args) => run(command, [...args]));

  if (platform === "darwin") {
    await opener("open", [url]);
    return true;
  }
  if (platform === "win32") {
    await opener("cmd", ["/c", "start", "", url]);
    return true;
  }
  await opener("xdg-open", [url]);
  return true;
}

// ---- the session snapshot (the BEFORE) --------------------------------------------

export type SessionSnapshot = {
  readonly version: 1;
  readonly takenAt: string;
  readonly root: string;
  readonly workspaceId: string;
  readonly repoRoots: readonly string[];
  readonly fileHashes: Readonly<Record<string, string>>;
  readonly repoFiles: readonly RepoFiles[];
};

export function snapshotPath(workspaceId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(workspaceDir(workspaceId, env), "session-before.json");
}

export async function takeSnapshot(
  rootInput: string,
  envInput: NodeJS.ProcessEnv = process.env
): Promise<{ readonly path: string; readonly files: number; readonly repos: number }> {
  const workspace = await resolveWorkspace(rootInput);
  const env = workspaceStateEnv(workspace.root, envInput);
  const workspaceId = workspaceIdFor(workspace.repos.map((repo) => repo.root));
  const before = await collectWorkspaceFacts(workspace);
  const snapshot: SessionSnapshot = {
    version: 1,
    takenAt: new Date().toISOString(),
    root: workspace.root,
    workspaceId,
    repoRoots: workspace.repos.map((repo) => repo.root),
    fileHashes: before.fileHashes,
    repoFiles: before.repoFiles
  };
  const target = snapshotPath(workspaceId, env);
  await mkdir(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `session-before.json.tmp-${process.pid}`);
  await writeFile(tmp, JSON.stringify(snapshot), "utf8");
  await rename(tmp, target);
  return { path: target, files: Object.keys(before.fileHashes).length, repos: workspace.repos.length };
}

async function readSnapshot(
  workspaceId: string,
  root: string,
  env: NodeJS.ProcessEnv
): Promise<SessionSnapshot | null> {
  try {
    const text = await readFile(snapshotPath(workspaceId, env), "utf8");
    const raw = JSON.parse(text) as SessionSnapshot & { readonly repoFiles?: RepoFiles | readonly RepoFiles[] };
    if (raw.version !== 1 || raw.root !== root || !raw.repoFiles) {
      return null;
    }
    return {
      version: 1,
      takenAt: raw.takenAt,
      root: raw.root,
      workspaceId: raw.workspaceId,
      repoRoots: raw.repoRoots ?? [root],
      fileHashes: raw.fileHashes,
      repoFiles: Array.isArray(raw.repoFiles) ? raw.repoFiles : [raw.repoFiles]
    };
  } catch {
    return null;
  }
}

// ---- the git fallback (concern #3): re-extract the pre-session tree from HEAD -----

type WorkspaceFacts = {
  readonly repoFiles: readonly RepoFiles[];
  readonly fileHashes: Readonly<Record<string, string>>;
};

function shouldQualifyPaths(workspace: ResolvedWorkspace): boolean {
  return workspace.isWorkspace;
}

async function collectWorkspaceFacts(workspace: ResolvedWorkspace): Promise<WorkspaceFacts> {
  const repoFiles: RepoFiles[] = [];
  const fileHashes: Record<string, string> = {};
  const qualify = shouldQualifyPaths(workspace);
  for (const spec of workspace.repos) {
    const collected = await collectRepoFacts(spec.repo, spec.root);
    const facts = qualify ? qualifyRepoFiles(collected.repoFiles) : collected.repoFiles;
    repoFiles.push(facts);
    Object.assign(fileHashes, qualify ? qualifyFileHashes(spec.repo, collected.fileHashes) : collected.fileHashes);
  }
  return { repoFiles, fileHashes };
}

async function collectRepoFromGitHead(
  spec: RepoSpec,
  qualify: boolean
): Promise<{ repoFiles: RepoFiles; fileHashes: Readonly<Record<string, string>> } | null> {
  const tmp = await mkdtemp(join(tmpdir(), "mappamind-before-"));
  try {
    const tar = join(tmp, "head.tar");
    await run("git", ["-C", spec.root, "archive", "--format=tar", "-o", tar, "HEAD"]);
    const tree = join(tmp, "tree");
    await mkdir(tree);
    await run("tar", ["-xf", tar, "-C", tree]);
    // capture lists files via git — make the extracted tree a repo with all staged
    await run("git", ["init", "-q", tree]);
    await run("git", ["-C", tree, "add", "-A"]);
    const { repoFiles, fileHashes } = await collectRepoFacts(spec.repo, tree);
    return {
      repoFiles: qualify ? qualifyRepoFiles(repoFiles) : repoFiles,
      fileHashes: qualify ? qualifyFileHashes(spec.repo, fileHashes) : fileHashes
    };
  } catch {
    return null; // not a git repo, or no commits yet — no before available
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function collectFromGitHead(workspace: ResolvedWorkspace): Promise<WorkspaceFacts | null> {
  const repoFiles: RepoFiles[] = [];
  const fileHashes: Record<string, string> = {};
  const qualify = shouldQualifyPaths(workspace);
  for (const spec of workspace.repos) {
    const collected = await collectRepoFromGitHead(spec, qualify);
    if (collected === null) {
      return null;
    }
    repoFiles.push(collected.repoFiles);
    Object.assign(fileHashes, collected.fileHashes);
  }
  return { repoFiles, fileHashes };
}

// ---- change detection: hash diff, both directions ---------------------------------

function diffHashes(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>
): string[] {
  const changed = new Set<string>();
  for (const [path, hash] of Object.entries(after)) {
    if (before[path] !== hash) changed.add(path); // edited or added
  }
  for (const path of Object.keys(before)) {
    if (!(path in after)) changed.add(path); // deleted — its dependents still matter
  }
  return [...changed].sort();
}

// ---- token accounting: the PLAN's "log token count", honestly estimated -----------

type CountingClient = ModelClient & { readonly chars: () => number };

function withCounting(client: ModelClient): CountingClient {
  let total = 0;
  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      total += (request.system?.length ?? 0) + request.prompt.length;
      const response = await client.complete(request);
      total += response.text.length;
      return response;
    },
    chars: () => total
  };
}

// ---- the shift runner --------------------------------------------------------------

export type ShiftInput = {
  readonly root: string;
  readonly client: ModelClient;
  readonly outPath?: string; // default <root>/.mappamind/shift/latest.html
  readonly env?: NodeJS.ProcessEnv;
  // The agent's session transcript, when the Stop hook can supply it (Phase 7).
  // Untrusted — it focuses adjudication on what changed; the verifier still gates.
  readonly transcript?: string;
};

export type ShiftOutcome = {
  readonly folded: boolean;
  readonly repoLabels: readonly string[];
  readonly reason?: "no-changes" | "cosmetic" | "no-before";
  readonly beforeSource?: "snapshot" | "git-head";
  readonly changedPaths: readonly string[];
  readonly card?: ShiftCard;
  readonly slice?: ImpactSlice;
  readonly diff?: MeshDiff;
  readonly htmlPath?: string;
  readonly modelChars: number; // chars through the narrator (≈ tokens × 4); 0 = no call
  readonly baselineStale: boolean;
  readonly filesSeen: number; // total files re-parsed this shift — drives the large-repo advisory
};

export async function runShift(input: ShiftInput): Promise<ShiftOutcome> {
  const workspace = await resolveWorkspace(input.root);
  const root = workspace.root;
  const repoLabels = workspace.repos.map((repo) => repo.repo);
  const env = workspaceStateEnv(root, input.env ?? process.env);
  const workspaceId = workspaceIdFor(workspace.repos.map((repo) => repo.root));

  const after = await collectWorkspaceFacts(workspace);
  const filesSeen = Object.keys(after.fileHashes).length;

  // The BEFORE: session snapshot first, `git archive HEAD` as the fallback.
  let beforeSource: "snapshot" | "git-head" = "snapshot";
  let before = await readSnapshot(workspaceId, root, env);
  let beforeFacts: WorkspaceFacts | null =
    before !== null ? { repoFiles: before.repoFiles, fileHashes: before.fileHashes } : null;
  if (beforeFacts === null) {
    beforeSource = "git-head";
    beforeFacts = await collectFromGitHead(workspace);
  }
  if (beforeFacts === null) {
    return { folded: true, repoLabels, reason: "no-before", changedPaths: [], modelChars: 0, baselineStale: false, filesSeen };
  }

  const changedPaths = diffHashes(beforeFacts.fileHashes, after.fileHashes);
  if (changedPaths.length === 0) {
    return { folded: true, repoLabels, reason: "no-changes", beforeSource, changedPaths, modelChars: 0, baselineStale: false, filesSeen };
  }

  // Everything below runs on the BEFORE model, so deleted files keep their
  // dependents; the mesh diff is before vs after.
  const beforeModel: WorkspaceModel = buildWorkspaceModel(beforeFacts.repoFiles);
  // Mesh edges come from the verified channel pipeline (model recognition behind the
  // verifier), diff-scoped: the "before" channels seed the cache so unchanged
  // candidates skip the model and only what the session touched is re-adjudicated.
  // The baseline's verified channels seed the before-mesh: unchanged candidates are
  // cache hits (no model call); only what the session changed gets re-adjudicated.
  const baselineCache = await readChannelCache(workspaceId, env);
  const beforeMeshResult = await buildServiceMesh({ files: beforeFacts.repoFiles.flatMap((repo) => repo.files), client: input.client, cache: baselineCache });
  const beforeMesh: ServiceGraph = beforeMeshResult.graph;
  const afterMeshResult = await buildServiceMesh({
    files: after.repoFiles.flatMap((repo) => repo.files),
    client: input.client,
    cache: beforeMeshResult.cache,
    ...(input.transcript ? { transcript: input.transcript } : {})
  });
  const afterMesh: ServiceGraph = afterMeshResult.graph;
  const diff = diffServiceGraphs(beforeMesh, afterMesh);
  // Channel-level diff carries the cited anchors the card renders as proof.
  const channelChanges = diffChannels(beforeMeshResult.channels, afterMeshResult.channels);
  const seams = detectSeams(beforeFacts.repoFiles);
  const baselineStatus = await loadBaselineStatus(workspaceId, after.repoFiles, env);
  const baseline: Baseline | undefined = baselineStatus.baseline ?? undefined;

  const slice = computeBlastRadius({
    model: beforeModel,
    changedPaths,
    ...(baseline ? { baseline } : {}),
    seams,
    mesh: beforeMesh,
    brokenContractConsumerFiles: diff.brokenContracts.map((contract) => contract.file)
  });

  const counting = withCounting(input.client);
  const card = await narrateShift({
    slice,
    diff,
    client: counting,
    baselineStale: baselineStatus.stale,
    channelChanges
  });

  // A non-cosmetic card at the default location is archived (one file per
  // session) so the Shifts tab can reopen any past card; the ledger row points
  // at it. A --out override is ad-hoc — no archive, no index refresh.
  const at = new Date().toISOString();
  const willArchive = card.severity !== "cosmetic" && input.outPath === undefined;
  const archiveName = `${at.replace(/[:.]/g, "-")}.html`;
  const ledgerRecord = {
    at,
    root,
    repos: workspace.repos.map((repo) => repo.repo),
    beforeSource,
    severity: card.severity,
    title: card.title,
    narrationSource: card.narrationSource,
    changedFiles: changedPaths.length,
    affectedFiles: slice.affectedFiles.length,
    brokenContracts: card.brokenContracts.length,
    modelChars: counting.chars(),
    ...(willArchive ? { cardFile: archiveName } : {})
  };
  await mkdir(workspaceDir(workspaceId, env), { recursive: true });
  await appendJsonLine(join(workspaceDir(workspaceId, env), "shifts.jsonl"), ledgerRecord);

  // The cosmetic fold: every card a human sees means something moved.
  if (card.severity === "cosmetic") {
    return {
      folded: true,
      repoLabels,
      reason: "cosmetic",
      beforeSource,
      changedPaths,
      card,
      slice,
      diff,
      modelChars: counting.chars(),
      baselineStale: baselineStatus.stale,
      filesSeen
    };
  }

  const involved = new Set<string>([
    ...card.brokenContracts.map((broken) => broken.service),
    ...slice.atRiskServiceEdges.flatMap((edge) => [edge.consumer, edge.provider]),
    ...diff.removedServices,
    ...diff.addedServices
  ]);
  const contextServices = afterMesh.services.filter((service) => !involved.has(service));

  const html = renderShiftCardHtml({ card, slice, diff, contextServices, repoName: basename(root) });
  const htmlPath = input.outPath ?? join(root, ".mappamind", "shift", "latest.html");
  await mkdir(dirname(htmlPath), { recursive: true });
  await writeFile(htmlPath, html, "utf8");

  if (willArchive) {
    const shiftDir = dirname(htmlPath);
    await writeFile(join(shiftDir, archiveName), html, "utf8");
    await pruneArchivedCards(shiftDir, MAX_ARCHIVED_CARDS);
    // Refresh the single-page app: the Shifts tab gains this session, and the
    // Studio/Contracts tabs reflect the current mesh. Only when a baseline exists.
    if (baseline) {
      const history = await readShiftHistory(workspaceId, env);
      const appHtml = renderAppHtml({
        title: workspace.repos.map((repo) => repo.repo).join(" + "),
        baseline,
        architecture: afterMesh,
        seams: detectSeams(after.repoFiles),
        channels: afterMeshResult.channels,
        history
      });
      const indexPath = join(root, ".mappamind", "index.html");
      await mkdir(dirname(indexPath), { recursive: true });
      await writeFile(indexPath, appHtml, "utf8");
    }
  }

  return {
    folded: false,
    repoLabels,
    beforeSource,
    changedPaths,
    card,
    slice,
    diff,
    htmlPath,
    modelChars: counting.chars(),
    baselineStale: baselineStatus.stale,
    filesSeen
  };
}
