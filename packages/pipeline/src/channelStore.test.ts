import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { Channel } from "@mappamind_/seam";

import { readChannelCache, writeChannelCache } from "./channelStore.js";

const channel: Channel = {
  key: "api/items",
  kind: "http",
  rationale: "catalog serves; web calls",
  memberships: [
    { service: "catalog", role: "produce", confidence: "verified", anchor: { service: "catalog", file: "catalog/api.cs", line: 31, text: "/api/items" } },
    { service: "web", role: "consume", confidence: "verified", anchor: { service: "web", file: "web/client.cs", line: 26, text: "/api/items" } }
  ]
};

test("channel cache round-trips through disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mappamind-chan-"));
  try {
    const env = { ...process.env, MAPPAMIND_STATE_DIR: dir };
    const cache = new Map([["hash-a", channel]]);
    await writeChannelCache("ws_x", cache, env);
    const loaded = await readChannelCache("ws_x", env);
    assert.equal(loaded.size, 1);
    assert.deepEqual(loaded.get("hash-a"), channel);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a missing cache file is an empty map, never an error (first run)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mappamind-chan-"));
  try {
    const env = { ...process.env, MAPPAMIND_STATE_DIR: dir };
    const loaded = await readChannelCache("ws_absent", env);
    assert.equal(loaded.size, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
