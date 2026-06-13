import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import type { ModelClient } from "@mappamind_/synthesis";

import { installCodexHooks } from "./hookConfig.js";
import { getMappamindStatus, runSetup } from "./onboarding.js";

async function makeRepo(): Promise<{ root: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), "mappamind-onboarding-"));
  const root = join(base, "repo");
  await mkdir(root);
  await writeFile(join(root, "a.ts"), `export function util(): number { return 1; }\n`);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  const env: NodeJS.ProcessEnv = { ...process.env, MAPPAMIND_STATE_DIR: join(base, "state") };
  return { root: await realpath(root), env, cleanup: () => rm(base, { recursive: true, force: true }) };
}

async function makeWorkspace(): Promise<{ root: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), "mappamind-onboarding-ws-"));
  const root = join(base, "workspace");
  const app = join(root, "app");
  const jobs = join(root, "jobs");
  await mkdir(app, { recursive: true });
  await mkdir(jobs, { recursive: true });
  await writeFile(join(app, "a.ts"), `export const app = true;\n`);
  await writeFile(join(jobs, "job.py"), "def run():\n    return 1\n", "utf8");
  for (const repo of [app, jobs]) {
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  }
  const env: NodeJS.ProcessEnv = { ...process.env, MAPPAMIND_STATE_DIR: join(base, "state") };
  return { root: await realpath(root), env, cleanup: () => rm(base, { recursive: true, force: true }) };
}

function fakeClient(calls: string[] = []): ModelClient {
  return {
    async complete(): Promise<{ text: string }> {
      calls.push("complete");
      return {
        text: JSON.stringify({
          capabilities: [
            {
              name: "Core",
              summary: "Core utility behavior",
              members: [{ repo: "repo", file: "a.ts", symbol: "util" }]
            }
          ],
          edges: [],
          unknowns: []
        })
      };
    }
  };
}

test("status reports a missing baseline for a fresh repo", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const status = await getMappamindStatus({ root, env });
    assert.equal(status.baseline.state, "missing");
    assert.equal(status.repos.length, 1);
    assert.equal(status.filesSeen, 1);
    assert.equal(status.filesExtracted, 1);
    assert.equal(status.baseline.studioPath, undefined);
  } finally {
    await cleanup();
  }
});

test("status defaults durable memory to the workspace .mappamind directory", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const localEnv = { ...env };
    delete localEnv["MAPPAMIND_STATE_DIR"];
    const status = await getMappamindStatus({ root, env: localEnv });
    assert.equal(status.baseline.path, join(root, ".mappamind", "state", "workspaces", status.workspaceId, "baseline.json"));
  } finally {
    await cleanup();
  }
});

test("status resolves a non-git workspace and qualifies child repos", async () => {
  const { root, env, cleanup } = await makeWorkspace();
  try {
    const status = await getMappamindStatus({ root, env });
    assert.equal(status.isWorkspace, true);
    assert.deepEqual(status.repos.map((repo) => repo.repo), ["app", "jobs"]);
    assert.equal(status.baseline.state, "missing");
  } finally {
    await cleanup();
  }
});

test("setup without a host prints a user-facing error without a stack trace", () => {
  const cli = fileURLToPath(new URL("./mappamind.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "setup"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /mappamind: setup needs a model host/);
  assert.match(result.stderr, /mappamind setup \. --host claude --yes/);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("setup creates Studio, then skips when the baseline is current", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const progress: string[] = [];
    const calls: string[] = [];
    const first = await runSetup({
      root,
      env,
      client: fakeClient(calls),
      assumeYes: true,
      progress: (message) => progress.push(message)
    });
    assert.equal(first.ran, true);
    assert.equal(first.reason, "missing");
    assert.ok(first.studioPath);
    assert.ok(existsSync(first.studioPath!));
    assert.ok(first.studioUrl?.startsWith("file://"));
    assert.equal(existsSync(join(root, ".mappamind", "baseline", "latest.html")), false);
    assert.equal(existsSync(join(env.MAPPAMIND_STATE_DIR!, "workspaces", first.status.workspaceId, "baseline.html")), false);
    assert.ok(first.channelCachePath);
    assert.equal(first.channelCachePath, join(env.MAPPAMIND_STATE_DIR!, "workspaces", first.status.workspaceId, "channels.json"));
    assert.deepEqual(JSON.parse(await readFile(first.channelCachePath!, "utf8")), {});
    assert.deepEqual(calls, ["complete"]);
    assert.equal(first.synthesis?.capabilities, 1);
    assert.equal(first.synthesis?.modelAttempts, 1);
    assert.equal(first.synthesis?.modelCalls, 1);
    assert.equal(first.synthesis?.repoErrors.length, 0);
    assert.ok(progress.some((message) => message.includes("Discovering repos")));
    assert.ok(progress.some((message) => message.includes("Capturing files")));
    assert.ok(progress.some((message) => message.includes("Synthesizing grounded capabilities")));
    assert.ok(progress.some((message) => message.includes("Writing Studio")));

    const status = await getMappamindStatus({ root, env });
    assert.equal(status.baseline.state, "current");
    assert.equal(status.baseline.studioPath, first.studioPath);

    const secondCalls: string[] = [];
    const second = await runSetup({ root, env, client: fakeClient(secondCalls), assumeYes: true });
    assert.equal(second.ran, false);
    assert.equal(second.reason, "current");
    assert.deepEqual(secondCalls, []);
  } finally {
    await cleanup();
  }
});

test("setup reports when model synthesis returns no grounded capabilities", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const outcome = await runSetup({
      root,
      env,
      client: {
        async complete(): Promise<{ text: string }> {
          return { text: JSON.stringify({ capabilities: [], edges: [], unknowns: [] }) };
        }
      },
      assumeYes: true
    });

    assert.equal(outcome.ran, true);
    assert.equal(outcome.synthesis?.capabilities, 0);
    assert.equal(outcome.synthesis?.modelAttempts, 1);
    assert.equal(outcome.synthesis?.modelCalls, 1);
    assert.equal(outcome.synthesis?.repoErrors.length, 0);
  } finally {
    await cleanup();
  }
});

test("setup refuses an unparseable model synthesis result and writes no baseline artifacts", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await assert.rejects(
      () => runSetup({
        root,
        env,
        client: {
          async complete(): Promise<{ text: string }> {
            return { text: "not json" };
          }
        },
        assumeYes: true
      }),
      /Model-backed synthesis failed for every repo/
    );
    assert.equal(existsSync(join(env.MAPPAMIND_STATE_DIR!, "workspaces")), false);
    assert.equal(existsSync(join(root, ".mappamind")), false);
  } finally {
    await cleanup();
  }
});

test("setup refuses a model host failure and writes no baseline artifacts", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await assert.rejects(
      () => runSetup({
        root,
        env,
        client: {
          async complete(): Promise<{ text: string }> {
            throw new Error("claude -p exited 1: no stderr");
          }
        },
        assumeYes: true
      }),
      /claude -p exited 1: no stderr/
    );
    assert.equal(existsSync(join(env.MAPPAMIND_STATE_DIR!, "workspaces")), false);
    assert.equal(existsSync(join(root, ".mappamind")), false);
  } finally {
    await cleanup();
  }
});

test("setup keeps partial synthesis when at least one repo grounds", async () => {
  const { root, env, cleanup } = await makeWorkspace();
  try {
    const outcome = await runSetup({
      root,
      env,
      client: {
        async complete(request): Promise<{ text: string }> {
          if (request.prompt.includes('repo "jobs"')) {
            throw new Error("codex exec exited 1");
          }
          return {
            text: JSON.stringify({
              capabilities: [
                {
                  name: "App",
                  summary: "App behavior",
                  members: [{ repo: "app", file: "app/a.ts", symbol: "app" }]
                }
              ],
              edges: [],
              unknowns: []
            })
          };
        }
      },
      assumeYes: true
    });

    assert.equal(outcome.ran, true);
    assert.equal(outcome.synthesis?.capabilities, 1);
    assert.equal(outcome.synthesis?.modelAttempts, 2);
    assert.equal(outcome.synthesis?.modelCalls, 1);
    assert.equal(outcome.synthesis?.repoErrors.length, 1);
    assert.ok(outcome.baselinePath);
  } finally {
    await cleanup();
  }
});

test("setup requires approval and status becomes stale after structural changes", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const skipped = await runSetup({
      root,
      env,
      client: fakeClient(),
      confirm: async () => false
    });
    assert.equal(skipped.ran, false);
    assert.equal(skipped.reason, "not-approved");
    assert.equal(existsSync(join(root, ".mappamind", "baseline", "latest.html")), false);

    await runSetup({ root, env, client: fakeClient(), assumeYes: true });
    await writeFile(join(root, "c.ts"), `export function added(): number { return 2; }\n`);
    const stale = await getMappamindStatus({ root, env });
    assert.equal(stale.baseline.state, "stale");
    assert.match(stale.baseline.warning ?? "", /checking out another branch/);
    assert.match(stale.baseline.warning ?? "", /shift cards still compare session start to session end/);

    const refreshed = await runSetup({ root, env, client: fakeClient(), assumeYes: true });
    assert.equal(refreshed.ran, true);
    assert.equal(refreshed.reason, "stale");
  } finally {
    await cleanup();
  }
});

test("status warns when project Codex hooks are installed", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await installCodexHooks(root);
    const status = await getMappamindStatus({ root, env });
    assert.equal(status.hooks.codexProjectHooks, true);
    assert.ok(status.hooks.warnings.some((warning) => warning.includes("mappamind hooks --remove --agent codex")));
  } finally {
    await cleanup();
  }
});
