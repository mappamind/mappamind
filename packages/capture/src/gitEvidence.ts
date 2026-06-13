import type { EvidenceEvent, JsonObject } from "@mappamind_/core";

import { runGit } from "./gitCommand.js";
import { classifyFile, shouldCaptureForModel } from "./languages.js";
import type { CoverageReport, FileCategory, LanguageCoverage, SkipCoverage } from "./languages.js";
import {
  DEFAULT_MAX_CHANGED_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_PROJECT_FILE_BYTES,
  DEFAULT_MAX_PROJECT_FILES,
  filterStatusPorcelain,
  isIgnoredPath
} from "./localPolicy.js";

export type GitRootResult = {
  readonly gitRoot: string;
};

export type GitStatusSnapshot = {
  readonly gitRoot: string;
  readonly branch: string;
  readonly porcelain: string;
};

export type GitRepositoryIdentity = {
  readonly gitRoot: string;
  readonly remoteUrl?: string;
  readonly defaultBranch?: string;
};

export type GitDiffSnapshot = {
  readonly gitRoot: string;
  readonly unstagedDiff: string;
  readonly stagedDiff: string;
};

export type FileContentFact = {
  readonly path: string;
  readonly bytes: number;
  readonly language?: string;
  readonly category?: FileCategory;
  readonly text?: string;
  readonly skipped?: "too_large" | "binary" | "missing";
};

export type FileContentSnapshot = {
  readonly gitRoot: string;
  readonly files: readonly FileContentFact[];
  // Present for project-wide snapshots: the honest "what did you read?" report.
  readonly coverage?: CoverageReport;
};

export async function resolveGitRoot(cwd: string): Promise<GitRootResult> {
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || "Unable to resolve git root");
  }
  return { gitRoot: result.stdout.trim() };
}

export async function captureGitStatus(cwd: string): Promise<GitStatusSnapshot> {
  const { gitRoot } = await resolveGitRoot(cwd);
  const [branchResult, statusResult] = await Promise.all([
    runGit(["branch", "--show-current"], { cwd: gitRoot }),
    runGit(["status", "--short", "--untracked-files=all"], { cwd: gitRoot })
  ]);

  if (branchResult.exitCode !== 0) {
    throw new Error(branchResult.stderr.trim() || "Unable to read git branch");
  }
  if (statusResult.exitCode !== 0) {
    throw new Error(statusResult.stderr.trim() || "Unable to read git status");
  }

  return {
    gitRoot,
    branch: branchResult.stdout.trim(),
    porcelain: filterStatusPorcelain(statusResult.stdout)
  };
}

export async function captureGitRepositoryIdentity(cwd: string): Promise<GitRepositoryIdentity> {
  const { gitRoot } = await resolveGitRoot(cwd);
  const [remoteResult, defaultBranchResult] = await Promise.all([
    runGit(["config", "--get", "remote.origin.url"], { cwd: gitRoot }),
    runGit(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: gitRoot })
  ]);

  const remoteUrl =
    remoteResult.exitCode === 0 && remoteResult.stdout.trim().length > 0
      ? remoteResult.stdout.trim()
      : undefined;
  const defaultBranch =
    defaultBranchResult.exitCode === 0 && defaultBranchResult.stdout.trim().length > 0
      ? defaultBranchResult.stdout.trim().replace(/^origin\//, "")
      : undefined;

  return {
    gitRoot,
    ...(remoteUrl ? { remoteUrl } : {}),
    ...(defaultBranch ? { defaultBranch } : {})
  };
}

export async function captureGitDiff(cwd: string): Promise<GitDiffSnapshot> {
  const { gitRoot } = await resolveGitRoot(cwd);
  const [unstagedResult, stagedResult] = await Promise.all([
    runGit(["diff", "--no-ext-diff"], { cwd: gitRoot, maxOutputBytes: 4 * 1024 * 1024 }),
    runGit(["diff", "--cached", "--no-ext-diff"], {
      cwd: gitRoot,
      maxOutputBytes: 4 * 1024 * 1024
    })
  ]);

  if (unstagedResult.exitCode !== 0) {
    throw new Error(unstagedResult.stderr.trim() || "Unable to capture unstaged diff");
  }
  if (stagedResult.exitCode !== 0) {
    throw new Error(stagedResult.stderr.trim() || "Unable to capture staged diff");
  }

  return {
    gitRoot,
    unstagedDiff: unstagedResult.stdout,
    stagedDiff: stagedResult.stdout
  };
}

function parseStatusPaths(status: string): readonly string[] {
  return status
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const rawPath = line.slice(3).trim();
      return rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
    });
}

export async function captureFileContents(cwd: string, maxFiles = DEFAULT_MAX_CHANGED_FILES, maxBytesPerFile = DEFAULT_MAX_FILE_BYTES): Promise<FileContentSnapshot> {
  const { readFile, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const status = await captureGitStatus(cwd);
  const files: FileContentFact[] = [];

  for (const path of parseStatusPaths(status.porcelain).filter((candidate) => !isIgnoredPath(candidate)).slice(0, maxFiles)) {
    const absolute = join(status.gitRoot, path);
    const { language, category } = classifyFile(path);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) {
        continue;
      }
      if (info.size > maxBytesPerFile) {
        files.push({ path, bytes: info.size, language, category, skipped: "too_large" });
        continue;
      }
      const bytes = await readFile(absolute);
      if (bytes.includes(0)) {
        files.push({ path, bytes: bytes.byteLength, language, category, skipped: "binary" });
        continue;
      }
      files.push({ path, bytes: bytes.byteLength, language, category, text: bytes.toString("utf8") });
    } catch {
      files.push({ path, bytes: 0, language, category, skipped: "missing" });
    }
  }

  return {
    gitRoot: status.gitRoot,
    files
  };
}

type MutableLanguageCoverage = {
  language: string;
  category: FileCategory;
  files: number;
  bytes: number;
};

function buildCoverage(args: {
  readonly files: readonly FileContentFact[];
  readonly totalListed: number;
  readonly assetSkipped: number;
  readonly overCap: number;
  readonly tooLarge: number;
  readonly binary: number;
  readonly missing: number;
}): CoverageReport {
  const read = args.files.filter((file) => file.text !== undefined);
  const byLanguageMap = new Map<string, MutableLanguageCoverage>();
  for (const file of read) {
    const language = file.language ?? "unknown";
    const existing = byLanguageMap.get(language);
    if (existing) {
      existing.files += 1;
      existing.bytes += file.bytes;
    } else {
      byLanguageMap.set(language, {
        language,
        category: file.category ?? "unknown",
        files: 1,
        bytes: file.bytes
      });
    }
  }
  const byLanguage: LanguageCoverage[] = [...byLanguageMap.values()].sort(
    (a, b) => b.files - a.files
  );

  const skipped: SkipCoverage[] = [];
  if (args.assetSkipped > 0) skipped.push({ reason: "asset", files: args.assetSkipped });
  if (args.overCap > 0) skipped.push({ reason: "over_cap", files: args.overCap });
  if (args.tooLarge > 0) skipped.push({ reason: "too_large", files: args.tooLarge });
  if (args.binary > 0) skipped.push({ reason: "binary", files: args.binary });
  if (args.missing > 0) skipped.push({ reason: "missing", files: args.missing });

  return {
    totalListed: args.totalListed,
    captured: read.length,
    truncatedByCap: args.overCap > 0,
    byLanguage,
    skipped
  };
}

export async function captureProjectFiles(cwd: string, maxFiles = DEFAULT_MAX_PROJECT_FILES, maxBytesPerFile = DEFAULT_MAX_PROJECT_FILE_BYTES): Promise<FileContentSnapshot> {
  const { readFile, stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { gitRoot } = await resolveGitRoot(cwd);
  // 16 MiB of paths ≈ a ~250k-file listing; a large (~30k-file) monorepo is already
  // ~2 MiB of paths, so a 2 MiB ceiling would fail loudly on repos we explicitly target.
  const listResult = await runGit(["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: gitRoot,
    maxOutputBytes: 16 * 1024 * 1024
  });
  if (listResult.exitCode !== 0) {
    throw new Error(listResult.stderr.trim() || "Unable to list project files");
  }

  // Classify every listed file by language. Capture all text; skip only assets.
  // Nothing is dropped in silence: the coverage report accounts for every file.
  const listed = listResult.stdout
    .split(/\r?\n/)
    .filter((path) => path.length > 0)
    .filter((path) => !isIgnoredPath(path))
    .map((path) => ({ path, ...classifyFile(path) }));

  const captureCandidates = listed.filter((entry) => shouldCaptureForModel(entry));
  const assetSkipped = listed.length - captureCandidates.length;
  const toRead = captureCandidates.slice(0, maxFiles);
  const overCap = captureCandidates.length - toRead.length;

  const files: FileContentFact[] = [];
  let tooLarge = 0;
  let binary = 0;
  let missing = 0;

  for (const entry of toRead) {
    const { path, language, category } = entry;
    const absolute = join(gitRoot, path);
    try {
      const info = await stat(absolute);
      if (!info.isFile()) {
        continue;
      }
      if (info.size > maxBytesPerFile) {
        files.push({ path, bytes: info.size, language, category, skipped: "too_large" });
        tooLarge += 1;
        continue;
      }
      const bytes = await readFile(absolute);
      if (bytes.includes(0)) {
        files.push({ path, bytes: bytes.byteLength, language, category, skipped: "binary" });
        binary += 1;
        continue;
      }
      files.push({ path, bytes: bytes.byteLength, language, category, text: bytes.toString("utf8") });
    } catch {
      files.push({ path, bytes: 0, language, category, skipped: "missing" });
      missing += 1;
    }
  }

  const coverage = buildCoverage({
    files,
    totalListed: listed.length,
    assetSkipped,
    overCap,
    tooLarge,
    binary,
    missing
  });

  return {
    gitRoot,
    files,
    coverage
  };
}

export type CreateGitEvidenceInput = {
  readonly eventId: string;
  readonly repoId: string;
  readonly sessionId?: string;
  readonly episodeId?: string;
  readonly cwd: string;
  readonly timestamp?: string;
};

export async function createGitStatusEvidence(
  input: CreateGitEvidenceInput
): Promise<EvidenceEvent> {
  const snapshot = await captureGitStatus(input.cwd);
  return {
    eventId: input.eventId,
    repoId: input.repoId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    source: "git",
    eventType: "git_status_snapshot",
    cwd: input.cwd,
    payload: snapshot as unknown as JsonObject,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}

export async function createGitDiffEvidence(
  input: CreateGitEvidenceInput
): Promise<EvidenceEvent> {
  const snapshot = await captureGitDiff(input.cwd);
  return {
    eventId: input.eventId,
    repoId: input.repoId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    source: "git",
    eventType: "git_diff_snapshot",
    cwd: input.cwd,
    payload: snapshot as unknown as JsonObject,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}

export async function createFileContentEvidence(input: CreateGitEvidenceInput): Promise<EvidenceEvent> {
  const snapshot = await captureFileContents(input.cwd);
  return {
    eventId: input.eventId,
    repoId: input.repoId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    source: "filesystem",
    eventType: "file_content_snapshot",
    cwd: input.cwd,
    payload: snapshot as unknown as JsonObject,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}

export async function createProjectSnapshotEvidence(input: CreateGitEvidenceInput): Promise<EvidenceEvent> {
  const snapshot = await captureProjectFiles(input.cwd);
  return {
    eventId: input.eventId,
    repoId: input.repoId,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.episodeId ? { episodeId: input.episodeId } : {}),
    source: "filesystem",
    eventType: "project_file_snapshot",
    cwd: input.cwd,
    payload: snapshot as unknown as JsonObject,
    timestamp: input.timestamp ?? new Date().toISOString()
  };
}
