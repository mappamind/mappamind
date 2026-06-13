export const DEFAULT_IGNORED_PATH_PARTS = new Set([
  ".git",
  ".mappamind",
  "node_modules",
  "bower_components",
  "vendor",
  "vendors",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".cache",
  "coverage",
  "target",
  ".dart_tool",
  ".gradle",
  ".idea",
  ".venv",
  "venv",
  "__pycache__"
]);

export const DEFAULT_MAX_WATCHED_DIRS = 1_500;
export const DEFAULT_MAX_PROJECT_FILES = 300;
export const DEFAULT_MAX_CHANGED_FILES = 64;
export const DEFAULT_MAX_FILE_BYTES = 128 * 1024;
export const DEFAULT_MAX_PROJECT_FILE_BYTES = 96 * 1024;

export function isIgnoredPath(path: string, ignoredParts: ReadonlySet<string> = DEFAULT_IGNORED_PATH_PARTS): boolean {
  return path.split(/[\\/]/).some((part) => ignoredParts.has(part));
}

export function filterStatusPorcelain(status: string): string {
  return status
    .split(/\r?\n/)
    .filter((line) => {
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) ?? rawPath : rawPath;
      return path.length > 0 && !isIgnoredPath(path);
    })
    .join("\n");
}
