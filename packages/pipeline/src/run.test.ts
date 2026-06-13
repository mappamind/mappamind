import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";
import type { RepoFiles } from "@mappamind_/baseline";
import type { ModelClient } from "@mappamind_/synthesis";

import { assembleBaseline, collectAndBuild } from "./run.js";

function file(partial: Partial<FileFacts> & { path: string; language: string }): FileFacts {
  return { symbols: [], imports: [], calls: [], exports: [], anchors: [], ...partial };
}

const repos: RepoFiles[] = [
  {
    repo: "app",
    files: [
      file({ path: "src/checkout.ts", language: "typescript", symbols: [{ kind: "function", name: "checkout", line: 1 }] })
    ]
  }
];

function fakeClient(text: string): ModelClient {
  return { complete: async () => ({ text }) };
}

test("assembleBaseline grounds, persists, and reports the store path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bv-pipeline-"));
  try {
    const env = { ...process.env, MAPPAMIND_STATE_DIR: dir };
    const response = JSON.stringify({
      capabilities: [
        { name: "Checkout", summary: "orders", members: [{ repo: "app", file: "src/checkout.ts", symbol: "checkout" }] },
        { name: "Fake", summary: "x", members: [{ repo: "app", file: "ghost.ts" }] }
      ],
      edges: [],
      unknowns: []
    });

    const result = await assembleBaseline({ repos, client: fakeClient(response), workspaceId: "ws_pipe", env });

    // Grounded: real capability kept, hallucinated one dropped.
    assert.equal(result.synthesis.baseline.capabilities.length, 1);
    assert.equal(result.synthesis.droppedCapabilities.length, 1);

    // Persisted: the file exists and round-trips.
    assert.ok(result.storePath);
    const onDisk = JSON.parse(await readFile(result.storePath!, "utf8"));
    assert.equal(onDisk.workspaceId, "ws_pipe");
    assert.equal(onDisk.capabilities[0].name, "Checkout");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("persist:false skips the write", async () => {
  const result = await assembleBaseline({
    repos,
    client: fakeClient('{"capabilities":[],"edges":[],"unknowns":[]}'),
    workspaceId: "ws_nopersist",
    persist: false
  });
  assert.equal(result.storePath, undefined);
});

test("collectAndBuild qualifies file paths in multi-repo workspaces", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mappamind-pipeline-workspace-"));
  try {
    const app = join(dir, "app");
    const jobs = join(dir, "jobs");
    await mkdir(join(app, "src"), { recursive: true });
    await mkdir(join(jobs, "src"), { recursive: true });
    await writeFile(join(app, "src", "shared.ts"), "export const app = true;\n", "utf8");
    await writeFile(join(jobs, "src", "shared.ts"), "export const jobs = true;\n", "utf8");
    for (const repo of [app, jobs]) {
      execFileSync("git", ["init", "-q", repo]);
      execFileSync("git", ["-C", repo, "add", "-A"]);
      execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    }

    const result = await collectAndBuild({
      repos: [
        { repo: "app", root: app },
        { repo: "jobs", root: jobs }
      ],
      client: fakeClient('{"capabilities":[],"edges":[],"unknowns":[]}'),
      persist: false
    });

    assert.deepEqual(
      result.model.modules.map((module) => module.path).sort(),
      ["app/src/shared.ts", "jobs/src/shared.ts"]
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
