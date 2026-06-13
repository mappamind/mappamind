export { runGit } from "./gitCommand.js";
export type { GitCommandOptions, GitCommandResult } from "./gitCommand.js";
export { startFileSystemWatcher } from "./fsWatcher.js";
export type { MappamindFileSystemWatcher, FileSystemChange, FileSystemWatcherOptions } from "./fsWatcher.js";
export { redactJsonValue, redactText } from "./redaction.js";
export type { RedactionResult } from "./redaction.js";
export { classifyFile, shouldCaptureForModel } from "./languages.js";
export type {
  CoverageReport,
  FileCategory,
  FileClassification,
  LanguageCoverage,
  SkipCoverage
} from "./languages.js";
export {
  DEFAULT_IGNORED_PATH_PARTS,
  DEFAULT_MAX_CHANGED_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_PROJECT_FILE_BYTES,
  DEFAULT_MAX_PROJECT_FILES,
  DEFAULT_MAX_WATCHED_DIRS,
  filterStatusPorcelain,
  isIgnoredPath
} from "./localPolicy.js";
export {
  captureFileContents,
  captureGitDiff,
  captureGitRepositoryIdentity,
  captureGitStatus,
  captureProjectFiles,
  createFileContentEvidence,
  createGitDiffEvidence,
  createProjectSnapshotEvidence,
  createGitStatusEvidence,
  resolveGitRoot
} from "./gitEvidence.js";
export type {
  CreateGitEvidenceInput,
  FileContentFact,
  FileContentSnapshot,
  GitDiffSnapshot,
  GitRepositoryIdentity,
  GitRootResult,
  GitStatusSnapshot
} from "./gitEvidence.js";
