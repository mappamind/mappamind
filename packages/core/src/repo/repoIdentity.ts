import { createHash } from "node:crypto";
import { resolve } from "node:path";

export function createRepoId(gitRoot: string, remoteUrl?: string): string {
  const normalizedRoot = resolve(gitRoot);
  const stableInput = remoteUrl ? `${normalizedRoot}\n${remoteUrl}` : normalizedRoot;
  return `repo_${createHash("sha256").update(stableInput).digest("hex").slice(0, 16)}`;
}
