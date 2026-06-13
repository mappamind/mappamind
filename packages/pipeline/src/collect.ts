// Collect normalized facts for one repo: capture -> extract.
//
// captureProjectFiles reads the repo inclusively (M1a killed the JS-only allowlist);
// we then run the tree-sitter extractor on every file whose language we support.
// Files we cannot parse are counted, never silently dropped — the same honesty the
// coverage report carries.

import { createHash } from "node:crypto";

import { captureProjectFiles } from "@mappamind_/capture";
import { extractFileFacts, isExtractable } from "@mappamind_/extractors";
import type { FileFacts } from "@mappamind_/extractors";
import type { RepoFiles } from "@mappamind_/baseline";
import { contractKeyAnchors, isContractFile } from "@mappamind_/seam";

export type CollectSummary = {
  readonly repo: string;
  readonly filesSeen: number; // files in the snapshot
  readonly filesExtracted: number; // files we produced facts for
  readonly parseErrors: number; // supported language, but extraction failed
  readonly truncatedByCap: boolean; // the snapshot hit maxFiles — coverage is partial
  readonly languages: readonly string[];
};

export type CollectResult = {
  readonly repoFiles: RepoFiles;
  readonly summary: CollectSummary;
  // Content hash per captured text file — the session snapshot diffs these to
  // find what an agent changed. Binary files (no text) are not hashed: they are
  // invisible to the model anyway, so a change to one is cosmetic by definition.
  readonly fileHashes: Readonly<Record<string, string>>;
};

export function qualifyPath(repo: string, path: string): string {
  return `${repo}/${path}`;
}

export function qualifyRepoFiles(repoFiles: RepoFiles): RepoFiles {
  return {
    repo: repoFiles.repo,
    files: repoFiles.files.map((file) => ({ ...file, path: qualifyPath(repoFiles.repo, file.path) }))
  };
}

export function qualifyFileHashes(repo: string, hashes: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const qualified: Record<string, string> = {};
  for (const [path, hash] of Object.entries(hashes)) {
    qualified[qualifyPath(repo, path)] = hash;
  }
  return qualified;
}

// Large repos (microservice monorepos) have thousands of files; the capture default
// truncates and silently hides whole services. Read the whole repo for analysis.
// 50k covers a large (~30k-file) monorepo with headroom; if a repo still hits
// this, the summary says so (truncatedByCap) instead of silently under-reporting.
const MAX_PROJECT_FILES = 50_000;

// Above ~this many files, the full-tree re-parse on every SessionStart snapshot AND
// every Stop shift costs minutes (v0.1 captures the whole tree each time; incremental
// capture — re-parse only changed paths — is the fast-follow). Until then we say so
// honestly rather than hang silently. Env-overridable for users who want it quieter.
export const LARGE_REPO_WARN_FILES = (() => {
  const raw = Number(process.env["MAPPAMIND_LARGE_REPO_FILES"]);
  return Number.isFinite(raw) && raw > 0 ? raw : 5_000;
})();

// An honest one-line note when a repo is large enough that per-session latency is felt.
// null below the threshold — no note, no noise. Callers prefix it (prompt / status / shift).
export function largeRepoAdvisory(filesSeen: number): string | null {
  if (filesSeen < LARGE_REPO_WARN_FILES) return null;
  return `large repo (${filesSeen} files) — the first baseline takes a few minutes, and Mappamind re-reads the tree each session, so per-session shifts are slower. Incremental capture is coming.`;
}

// Capture's 96 KiB per-file default is sized for evidence snapshots, not analysis.
// Generated-but-load-bearing SOURCE routinely exceeds it (a FlutterFlow page widget
// is 109 KiB, a proto codegen module 151 KiB) — and a skipped file vanishes from the
// model, so a change to it would FOLD AS COSMETIC: the false-"safe" that breaks
// trust. 1 MiB keeps lockfile-scale noise out while reading every real module.
const MAX_PROJECT_FILE_BYTES = 1024 * 1024;

export async function collectRepoFacts(repo: string, root: string): Promise<CollectResult> {
  const snapshot = await captureProjectFiles(root, MAX_PROJECT_FILES, MAX_PROJECT_FILE_BYTES);
  const files: FileFacts[] = [];
  const languages = new Set<string>();
  const fileHashes: Record<string, string> = {};
  let parseErrors = 0;

  for (const fact of snapshot.files) {
    if (fact.text !== undefined) {
      fileHashes[fact.path] = createHash("sha256").update(fact.text).digest("hex").slice(0, 24);
    }
    if (!fact.language || !fact.text || !isExtractable(fact.language)) {
      // Declarative contracts (proto/OpenAPI) aren't parsed by tree-sitter, but their
      // declared channels are first-class evidence. Emit a synthetic FileFacts whose
      // anchors are the contract keys, so they flow through the same surfacer/verifier
      // as string anchors — a spec-declared route grounds the producer side authoritatively.
      if (fact.text && isContractFile(fact.path)) {
        const anchors = contractKeyAnchors(fact.path, fact.text).map((a) => ({ text: a.text, line: a.line, role: "literal" as const }));
        if (anchors.length > 0) {
          files.push({ path: fact.path, language: fact.language ?? "contract", symbols: [], imports: [], calls: [], exports: [], anchors });
        }
      }
      continue;
    }
    languages.add(fact.language);
    const facts = await extractFileFacts(fact.path, fact.text, fact.language);
    if (facts.parseError) {
      parseErrors += 1;
    }
    files.push(facts);
  }

  return {
    repoFiles: { repo, files },
    fileHashes,
    summary: {
      repo,
      filesSeen: snapshot.files.length,
      filesExtracted: files.length,
      parseErrors,
      truncatedByCap: snapshot.coverage?.truncatedByCap ?? false,
      languages: [...languages].sort()
    }
  };
}
