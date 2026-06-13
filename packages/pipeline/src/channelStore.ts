// Persist the verified-channel cache across runs (plan Phase 4/I7).
//
// The baseline run writes its verified channels keyed by candidate anchor hash; the
// accept-moment shift loads them so the "before" mesh reuses the baseline instead of
// re-adjudicating, and only candidates the session actually changed reach the model.
// Atomic write (temp + rename); a missing/unreadable file is a normal first-run
// state and yields an empty cache, never an error.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Channel } from "@mappamind_/seam";
import { workspaceDir } from "@mappamind_/store";

function channelsPath(workspaceId: string, env: NodeJS.ProcessEnv): string {
  return join(workspaceDir(workspaceId, env), "channels.json");
}

export async function writeChannelCache(
  workspaceId: string,
  cache: ReadonlyMap<string, Channel>,
  env: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const target = channelsPath(workspaceId, env);
  await mkdir(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `channels.json.tmp-${process.pid}`);
  await writeFile(tmp, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`, "utf8");
  await rename(tmp, target);
  return target;
}

export async function readChannelCache(
  workspaceId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<Map<string, Channel>> {
  try {
    const text = await readFile(channelsPath(workspaceId, env), "utf8");
    const obj = JSON.parse(text) as Record<string, Channel>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}
