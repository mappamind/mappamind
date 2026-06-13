import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { MappamindMode } from "../types/models.js";

export const MAPPAMIND_DIR = ".mappamind";
export const MAPPAMIND_CONFIG_FILE = "config.json";

export type MappamindIntelligenceMode = "auto" | "host" | "capsule" | "byok" | "local" | "none";

export type MappamindLocalConfig = {
  readonly version: 1;
  readonly repoId: string;
  readonly gitRoot: string;
  readonly mode: MappamindMode;
  readonly intelligence?: {
    readonly mode: MappamindIntelligenceMode;
  };
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly remoteUrl?: string;
  readonly defaultBranch?: string;
  readonly apiToken?: string;
};

export function getMappamindDir(gitRoot: string): string {
  return join(gitRoot, MAPPAMIND_DIR);
}

export function getMappamindConfigPath(gitRoot: string): string {
  return join(getMappamindDir(gitRoot), MAPPAMIND_CONFIG_FILE);
}

export async function readLocalConfig(gitRoot: string): Promise<MappamindLocalConfig | null> {
  try {
    const raw = await readFile(getMappamindConfigPath(gitRoot), "utf8");
    return JSON.parse(raw) as MappamindLocalConfig;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeLocalConfig(config: MappamindLocalConfig): Promise<void> {
  const path = getMappamindConfigPath(config.gitRoot);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
