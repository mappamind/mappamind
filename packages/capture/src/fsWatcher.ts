import { watch, type FSWatcher } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";

import { DEFAULT_IGNORED_PATH_PARTS, DEFAULT_MAX_WATCHED_DIRS, isIgnoredPath } from "./localPolicy.js";

export type FileSystemChange = {
  readonly path: string;
  readonly eventType: "rename" | "change";
  readonly timestamp: string;
};

export type FileSystemWatcherOptions = {
  readonly root: string;
  readonly debounceMs?: number;
  readonly maxQueuedEvents?: number;
  readonly ignoredDirs?: readonly string[];
  onFlush(changes: readonly FileSystemChange[]): void | Promise<void>;
};

export type MappamindFileSystemWatcher = {
  close(): void;
};

async function collectDirs(root: string, ignoredDirs: ReadonlySet<string>, maxDirs = DEFAULT_MAX_WATCHED_DIRS): Promise<string[]> {
  const dirs: string[] = [root];
  for (let index = 0; index < dirs.length; index += 1) {
    if (dirs.length >= maxDirs) {
      break;
    }
    const dir = dirs[index];
    if (!dir) {
      continue;
    }
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirs.has(entry.name)) {
        continue;
      }
      dirs.push(join(dir, entry.name));
      if (dirs.length >= maxDirs) {
        break;
      }
    }
  }
  return dirs;
}

export async function startFileSystemWatcher(
  options: FileSystemWatcherOptions
): Promise<MappamindFileSystemWatcher> {
  const debounceMs = options.debounceMs ?? 250;
  const maxQueuedEvents = options.maxQueuedEvents ?? 500;
  const ignoredDirs = new Set([...DEFAULT_IGNORED_PATH_PARTS, ...(options.ignoredDirs ?? [])]);
  const watchers: FSWatcher[] = [];
  let queue: FileSystemChange[] = [];
  let timer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (queue.length === 0 || closed) {
      return;
    }
    const changes = queue;
    queue = [];
    void options.onFlush(changes);
  };

  const schedule = (change: FileSystemChange): void => {
    if (closed) {
      return;
    }
    if (queue.length >= maxQueuedEvents) {
      queue = queue.slice(Math.max(0, queue.length - Math.floor(maxQueuedEvents / 2)));
    }
    queue.push(change);
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(flush, debounceMs);
  };

  const dirs = await collectDirs(options.root, ignoredDirs);
  for (const dir of dirs) {
    try {
      const watcher = watch(dir, { persistent: true }, (eventType, filename) => {
        if (!filename) {
          return;
        }
        const path = relative(options.root, join(dir, filename.toString()));
        if (isIgnoredPath(path, ignoredDirs)) {
          return;
        }
        schedule({
          path,
          eventType,
          timestamp: new Date().toISOString()
        });
      });
      watchers.push(watcher);
    } catch {
      // Some directories may be transient or permission-restricted. Git evidence remains the source of truth.
    }
  }

  return {
    close(): void {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers.length = 0;
      queue = [];
    }
  };
}
