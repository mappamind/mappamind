import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";
import type { Baseline, RepoFiles } from "@mappamind_/baseline";

import { factsHashFor, workspaceIdFor } from "./paths.js";
import { loadBaselineStatus, readBaseline, writeBaseline } from "./store.js";

function file(partial: Partial<FileFacts> & { path: string; language: string }): FileFacts {
  return { symbols: [], imports: [], calls: [], exports: [], anchors: [], ...partial };
}

function baselineFor(factsHash: string): Baseline {
  return {
    schemaVersion: 1,
    workspaceId: "ws_test",
    derivedFrom: { factsHash },
    capabilities: [
      { id: "cap_checkout", name: "Checkout", summary: "", members: [{ repo: "app", file: "src/checkout.ts" }], provenance: "derived", confidence: "high" }
    ],
    edges: [],
    unknowns: []
  };
}

const repos: RepoFiles[] = [
  { repo: "app", files: [file({ path: "src/checkout.ts", language: "typescript", symbols: [{ kind: "function", name: "checkout", line: 1 }] })] }
];

async function withTempStore(run: (env: NodeJS.ProcessEnv) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "bv-store-"));
  try {
    await run({ ...process.env, MAPPAMIND_STATE_DIR: dir });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writes a baseline atomically and reads it back identically", async () => {
  await withTempStore(async (env) => {
    const baseline = baselineFor("h1");
    const written = await writeBaseline("ws_test", baseline, env);
    assert.match(written, /workspaces\/ws_test\/baseline\.json$/);
    const roundTripped = await readBaseline("ws_test", env);
    assert.deepEqual(roundTripped, baseline);
  });
});

test("reading a never-written baseline returns null, not an error", async () => {
  await withTempStore(async (env) => {
    assert.equal(await readBaseline("ws_missing", env), null);
  });
});

test("detects staleness when the code's structure changes", async () => {
  await withTempStore(async (env) => {
    const hash = factsHashFor(repos);
    await writeBaseline("ws_test", baselineFor(hash), env);

    // Same code -> fresh.
    const fresh = await loadBaselineStatus("ws_test", repos, env);
    assert.equal(fresh.stale, false);

    // Structurally changed code (a new symbol) -> stale.
    const changed: RepoFiles[] = [
      { repo: "app", files: [file({ path: "src/checkout.ts", language: "typescript", symbols: [{ kind: "function", name: "checkout", line: 1 }, { kind: "function", name: "refund", line: 9 }] })] }
    ];
    const status = await loadBaselineStatus("ws_test", changed, env);
    assert.equal(status.stale, true);
  });
});

test("workspace id is stable and order-independent", () => {
  assert.equal(workspaceIdFor(["/a", "/b"]), workspaceIdFor(["/b", "/a"]));
  assert.notEqual(workspaceIdFor(["/a"]), workspaceIdFor(["/a", "/b"]));
});

test("facts hash ignores ordering but tracks real structure", () => {
  const reordered: RepoFiles[] = [
    {
      repo: "app",
      files: [...repos[0]!.files].reverse()
    }
  ];
  assert.equal(factsHashFor(repos), factsHashFor(reordered)); // order doesn't matter
});
