import { createReadStream } from "node:fs";
import { mkdir, appendFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

import type { JsonObject } from "@mappamind_/core";

export async function appendJsonLine(path: string, value: JsonObject): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, { encoding: "utf8" });
}

export async function readJsonLines<T extends JsonObject>(path: string): Promise<T[]> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const reader = createInterface({
    input: stream,
    crlfDelay: Infinity
  });
  const values: T[] = [];

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        continue;
      }
      values.push(JSON.parse(trimmed) as T);
    }
  } finally {
    reader.close();
    stream.destroy();
  }

  return values;
}

export type CompactJsonLinesOptions = {
  readonly maxLines: number;
  readonly maxBytes: number;
};

export async function compactJsonLines(path: string, options: CompactJsonLinesOptions): Promise<number> {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return 0;
    }
    throw error;
  }
  if (info.size <= options.maxBytes) {
    return 0;
  }
  const values = await readJsonLines<JsonObject>(path);
  const retained = values.slice(Math.max(0, values.length - options.maxLines));
  const compactedPath = `${path}.compact`;
  await writeFile(compactedPath, retained.map((value) => JSON.stringify(value)).join("\n") + (retained.length > 0 ? "\n" : ""), "utf8");
  await rename(compactedPath, path);
  return values.length - retained.length;
}
