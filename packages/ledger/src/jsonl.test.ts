import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EvidenceLedger } from "./evidenceLedger.js";
import { appendJsonLine, readJsonLines } from "./jsonl.js";

test("appendJsonLine creates parent directories and readJsonLines preserves order", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-ledger-"));
  const path = join(root, ".mappamind", "memory", "events.jsonl");

  try {
    await appendJsonLine(path, { eventId: "evt_1", source: "test" });
    await appendJsonLine(path, { eventId: "evt_2", source: "test" });

    const lines = await readJsonLines(path);

    assert.deepEqual(lines, [
      { eventId: "evt_1", source: "test" },
      { eventId: "evt_2", source: "test" }
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("EvidenceLedger compacts local evidence when retention bounds are exceeded", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-ledger-retention-"));

  try {
    const ledger = new EvidenceLedger({ rootDir: join(root, ".mappamind"), maxEvents: 3, maxBytes: 1 });
    for (let index = 0; index < 6; index += 1) {
      await ledger.appendEvent({
        eventId: `evt_${index}`,
        repoId: "repo_1",
        source: "test",
        eventType: "test_event",
        payload: { index },
        timestamp: "2026-06-06T00:00:00.000Z"
      });
    }

    const events = await ledger.readEvents();

    assert.deepEqual(events.map((event) => event.eventId), ["evt_3", "evt_4", "evt_5"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
