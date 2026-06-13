// Read/write the persisted baseline, and detect staleness (D12).
//
// Writes are atomic (temp file + rename) so a crash mid-write never leaves a
// half-baseline on disk. Reads tolerate a missing or unreadable file by returning
// null — an absent baseline is a normal first-run state, not an error. Staleness is
// a pure comparison of the stored fingerprint against the current one.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Baseline, RepoFiles } from "@mappamind_/baseline";

import { baselinePath, factsHashFor } from "./paths.js";

export async function writeBaseline(
  workspaceId: string,
  baseline: Baseline,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const target = baselinePath(workspaceId, env);
  await mkdir(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `baseline.json.tmp-${process.pid}`);
  await writeFile(tmp, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return target;
}

export async function readBaseline(
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<Baseline | null> {
  try {
    const text = await readFile(baselinePath(workspaceId, env), "utf8");
    return JSON.parse(text) as Baseline;
  } catch {
    return null;
  }
}

// The baseline is stale if the code it was derived from has structurally changed.
export function isStale(baseline: Baseline, currentFactsHash: string): boolean {
  return baseline.derivedFrom.factsHash !== currentFactsHash;
}

export type BaselineStatus = {
  readonly baseline: Baseline | null;
  readonly stale: boolean; // false when there is no baseline yet
  readonly currentFactsHash: string;
};

// Load the stored baseline and tell the caller whether it still matches the code.
export async function loadBaselineStatus(
  workspaceId: string,
  repos: readonly RepoFiles[],
  env: NodeJS.ProcessEnv = process.env
): Promise<BaselineStatus> {
  const currentFactsHash = factsHashFor(repos);
  const baseline = await readBaseline(workspaceId, env);
  return {
    baseline,
    stale: baseline !== null && isStale(baseline, currentFactsHash),
    currentFactsHash
  };
}
