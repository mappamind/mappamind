import { access } from "node:fs/promises";
import { join } from "node:path";

import type { EvidenceEvent, JsonObject } from "@mappamind_/core";

import { appendJsonLine, compactJsonLines, readJsonLines } from "./jsonl.js";

export type EvidenceLedgerPaths = {
  readonly rootDir: string;
  readonly maxEvents?: number;
  readonly maxBytes?: number;
};

export class EvidenceLedger {
  readonly #eventsPath: string;
  readonly #maxEvents: number;
  readonly #maxBytes: number;

  constructor(paths: EvidenceLedgerPaths) {
    this.#eventsPath = join(paths.rootDir, "memory", "events.jsonl");
    this.#maxEvents = paths.maxEvents ?? 2_000;
    this.#maxBytes = paths.maxBytes ?? 8 * 1024 * 1024;
  }

  async appendEvent(event: EvidenceEvent): Promise<void> {
    await appendJsonLine(this.#eventsPath, event as unknown as JsonObject);
    await compactJsonLines(this.#eventsPath, {
      maxLines: this.#maxEvents,
      maxBytes: this.#maxBytes
    });
  }

  async readEvents(): Promise<EvidenceEvent[]> {
    try {
      await access(this.#eventsPath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
    return readJsonLines<EvidenceEvent & JsonObject>(this.#eventsPath);
  }
}
