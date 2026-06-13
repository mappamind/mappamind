// Identity and location for the workspace store (D12).
//
// The low-level store only knows a state root + workspace id. Product entrypoints
// set MAPPAMIND_STATE_DIR to <workspace>/.mappamind/state by default, so the
// durable baseline/cache/snapshot live beside the repo/workspace the user ran on.
// The XDG fallback remains for direct package use and custom installs.

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

import type { RepoFiles, WorkspaceModel } from "@mappamind_/baseline";

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// The root that holds all workspaces. Order of precedence: explicit env override,
// XDG_STATE_HOME, then the XDG default.
export function stateRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (env["MAPPAMIND_STATE_DIR"]) {
    return env["MAPPAMIND_STATE_DIR"];
  }
  const xdg = env["XDG_STATE_HOME"];
  return xdg ? join(xdg, "mappamind") : join(homedir(), ".local", "state", "mappamind");
}

// Stable id for a workspace = hash of its repo roots, order-independent (sorted), so
// the same set of repos always maps to the same store regardless of listing order.
export function workspaceIdFor(repoRoots: readonly string[]): string {
  const canonical = [...repoRoots].sort().join("\n");
  return `ws_${shortHash(canonical)}`;
}

export function workspaceDir(workspaceId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(stateRoot(env), "workspaces", workspaceId);
}

export function baselinePath(workspaceId: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(workspaceDir(workspaceId, env), "baseline.json");
}

// The structural fingerprint the baseline was derived from. If the code's structure
// changes, this changes, and the stored baseline is known to be stale (D12). We hash
// a canonical projection of the facts — not formatting, not order — so only real
// structural change moves it.
export function factsHashFor(repos: readonly RepoFiles[]): string {
  const canonicalRepos = [...repos]
    .sort((a, b) => a.repo.localeCompare(b.repo))
    .map((repo) => ({
      repo: repo.repo,
      files: [...repo.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((file) => ({
          path: file.path,
          symbols: file.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`).sort(),
          exports: file.exports.map((exported) => exported.name).sort(),
          imports: file.imports.map((imported) => imported.module).sort(),
          calls: file.calls.map((call) => `${call.callee}(${call.args.join(",")})`).sort()
        }))
    }));
  return shortHash(JSON.stringify(canonicalRepos));
}

// Convenience: the id + fingerprint for a workspace, ready to stamp a baseline.
export function workspaceIdentity(
  repos: readonly RepoFiles[],
  _model?: WorkspaceModel
): { readonly workspaceId: string; readonly factsHash: string } {
  return {
    workspaceId: workspaceIdFor(repos.map((repo) => repo.repo)),
    factsHash: factsHashFor(repos)
  };
}
