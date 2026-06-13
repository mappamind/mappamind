import { readdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { resolveGitRoot } from "@mappamind_/capture";

import type { RepoSpec } from "./run.js";

const MAX_WORKSPACE_SCAN_DEPTH = 8;
const MAX_WORKSPACE_SCAN_DIRS = 20_000;
const PRUNED_WORKSPACE_DIRS = new Set([
  ".git",
  "node_modules"
]);

export type ResolvedWorkspace = {
  readonly root: string;
  readonly repos: readonly RepoSpec[];
  readonly isWorkspace: boolean;
};

async function tryResolveGitRoot(cwd: string): Promise<string | null> {
  try {
    const { gitRoot } = await resolveGitRoot(cwd);
    return resolve(gitRoot);
  } catch {
    return null;
  }
}

async function hasGitMetadata(dir: string): Promise<boolean> {
  try {
    const info = await stat(join(dir, ".git"));
    return info.isDirectory() || info.isFile();
  } catch {
    return false;
  }
}

function repoLabel(workspaceRoot: string, repoRoot: string): string {
  const rel = relative(workspaceRoot, repoRoot).split(sep).join("/");
  return rel && !rel.startsWith("..") ? rel : basename(repoRoot);
}

async function discoverGitRepos(root: string): Promise<readonly string[]> {
  const found = new Set<string>();
  let visited = 0;

  async function visit(dir: string, depth: number): Promise<void> {
    visited += 1;
    if (visited > MAX_WORKSPACE_SCAN_DIRS) {
      throw new Error(
        `Workspace scan exceeded ${MAX_WORKSPACE_SCAN_DIRS} directories under ${root}; pass a git repo root or split the workspace.`
      );
    }
    if (await hasGitMetadata(dir)) {
      const gitRoot = await tryResolveGitRoot(dir);
      if (gitRoot) {
        found.add(gitRoot);
      }
      return;
    }
    if (depth >= MAX_WORKSPACE_SCAN_DEPTH) {
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        continue;
      }
      if (PRUNED_WORKSPACE_DIRS.has(entry.name)) {
        continue;
      }
      await visit(join(dir, entry.name), depth + 1);
    }
  }

  await visit(root, 0);
  return [...found].sort();
}

export async function resolveWorkspace(rootInput: string): Promise<ResolvedWorkspace> {
  const root = await realpath(resolve(rootInput));
  const gitRoot = await tryResolveGitRoot(root);
  if (gitRoot) {
    return {
      root: gitRoot,
      repos: [{ repo: basename(gitRoot), root: gitRoot }],
      isWorkspace: false
    };
  }

  const repoRoots = await discoverGitRepos(root);
  if (repoRoots.length === 0) {
    throw new Error(`No git repositories found under ${root}; pass a git repo root or a workspace directory containing git repos.`);
  }

  return {
    root,
    repos: repoRoots.map((repoRoot) => ({ repo: repoLabel(root, repoRoot), root: repoRoot })),
    isWorkspace: true
  };
}
