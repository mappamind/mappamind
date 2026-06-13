import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readdir, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import type { ModelClient } from "@mappamind_/synthesis";
import { workspaceDir, workspaceIdFor, writeBaseline } from "@mappamind_/store";

import { fileUrlForPath, maybeOpenShiftCard, runShift, snapshotPath, takeSnapshot } from "./shift.js";

const deadClient: ModelClient = {
  complete: () => Promise.reject(new Error("no model in tests"))
};

// One fixture per test run: a tiny git repo where b.ts depends on a.ts.
async function makeRepo(): Promise<{ root: string; env: NodeJS.ProcessEnv; cleanup: () => Promise<void> }> {
  const base = await mkdtemp(join(tmpdir(), "mappamind-shift-"));
  const root = join(base, "repo");
  await mkdir(root);
  await writeFile(join(root, "a.ts"), `export function util(): number { return 1; }\n`);
  await writeFile(join(root, "b.ts"), `import { util } from "./a.js";\nexport const out = util();\n`);
  await writeFile(join(root, "leaf.ts"), `export const alone = 42;\n`);
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "add", "-A"]);
  execFileSync("git", ["-C", root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  const env: NodeJS.ProcessEnv = { ...process.env, MAPPAMIND_STATE_DIR: join(base, "state") };
  return { root: await realpath(root), env, cleanup: () => rm(base, { recursive: true, force: true }) };
}

async function makeWorkspace(): Promise<{
  root: string;
  appRoot: string;
  dataRoot: string;
  env: NodeJS.ProcessEnv;
  cleanup: () => Promise<void>;
}> {
  const base = await mkdtemp(join(tmpdir(), "mappamind-shift-workspace-"));
  const root = join(base, "workspace");
  const appRoot = join(root, "app");
  const dataRoot = join(root, "data-pipeline");
  await mkdir(appRoot, { recursive: true });
  await mkdir(dataRoot, { recursive: true });

  await writeFile(join(appRoot, "a.ts"), `export function util(): number { return 1; }\n`);
  await writeFile(join(appRoot, "b.ts"), `import { util } from "./a.js";\nexport const out = util();\n`);
  await writeFile(join(dataRoot, "job.py"), "def run():\n    return 1\n", "utf8");

  for (const repo of [appRoot, dataRoot]) {
    execFileSync("git", ["init", "-q", repo]);
    execFileSync("git", ["-C", repo, "add", "-A"]);
    execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  }

  const env: NodeJS.ProcessEnv = { ...process.env, MAPPAMIND_STATE_DIR: join(base, "state") };
  return {
    root: await realpath(root),
    appRoot: await realpath(appRoot),
    dataRoot: await realpath(dataRoot),
    env,
    cleanup: () => rm(base, { recursive: true, force: true })
  };
}

test("snapshot -> edit -> shift: the card lands at .mappamind/shift/latest.html", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const snap = await takeSnapshot(root, env);
    assert.ok(existsSync(snap.path));
    assert.ok(snap.files >= 3);

    await writeFile(join(root, "a.ts"), `export function util(): number { return 2; }\n`);
    const outcome = await runShift({ root, client: deadClient, env });

    assert.equal(outcome.folded, false);
    assert.equal(outcome.beforeSource, "snapshot");
    assert.deepEqual(outcome.changedPaths, ["a.ts"]);
    assert.equal(outcome.slice?.affectedFiles[0]?.path, "b.ts"); // the real dependent
    assert.equal(outcome.card?.narrationSource, "deterministic"); // dead client -> grounded fallback
    assert.equal(outcome.htmlPath, join(root, ".mappamind", "shift", "latest.html"));
    const html = await readFile(outcome.htmlPath!, "utf8");
    assert.ok(html.includes("b.ts"));
    assert.ok(html.includes("deterministic fallback")); // honesty rail admits it

    // the run is journaled in the workspace store
    const ledger = await readFile(join(workspaceDir(workspaceIdFor([root]), env), "shifts.jsonl"), "utf8");
    assert.ok(ledger.includes('"changedFiles":1'));
  } finally {
    await cleanup();
  }
});

test("snapshot defaults durable memory to the workspace .mappamind directory", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    const localEnv = { ...env };
    delete localEnv["MAPPAMIND_STATE_DIR"];
    const snap = await takeSnapshot(root, localEnv);
    assert.equal(
      snap.path,
      join(root, ".mappamind", "state", "workspaces", workspaceIdFor([root]), "session-before.json")
    );
    assert.ok(existsSync(snap.path));
  } finally {
    await cleanup();
  }
});

test("workspace root containing repos snapshots and shifts all repos", async () => {
  const { root, appRoot, dataRoot, env, cleanup } = await makeWorkspace();
  try {
    const snap = await takeSnapshot(root, env);
    assert.ok(existsSync(snap.path));
    assert.equal(snap.repos, 2);
    assert.equal(snap.path, snapshotPath(workspaceIdFor([appRoot, dataRoot]), env));

    await writeFile(join(appRoot, "a.ts"), `export function util(): number { return 2; }\n`);
    const outcome = await runShift({ root, client: deadClient, env });

    assert.equal(outcome.folded, false);
    assert.deepEqual(outcome.repoLabels, ["app", "data-pipeline"]);
    assert.deepEqual(outcome.changedPaths, ["app/a.ts"]);
    assert.equal(outcome.slice?.affectedFiles[0]?.path, "app/b.ts");
    assert.equal(outcome.htmlPath, join(root, ".mappamind", "shift", "latest.html"));
    const html = await readFile(outcome.htmlPath!, "utf8");
    assert.ok(html.includes("app/a.ts"));
    assert.ok(html.includes("app/b.ts"));

    const ledger = await readFile(join(workspaceDir(workspaceIdFor([appRoot, dataRoot]), env), "shifts.jsonl"), "utf8");
    assert.ok(ledger.includes('"repos":["app","data-pipeline"]'));
  } finally {
    await cleanup();
  }
});

test("a leaf edit folds as cosmetic — no card is written", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await takeSnapshot(root, env);
    await writeFile(join(root, "leaf.ts"), `export const alone = 43;\n`);
    const outcome = await runShift({ root, client: deadClient, env });
    assert.equal(outcome.folded, true);
    assert.equal(outcome.reason, "cosmetic");
    assert.equal(outcome.htmlPath, undefined);
    assert.ok(!existsSync(join(root, ".mappamind")));
  } finally {
    await cleanup();
  }
});

test("no changes at all folds without narrating", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await takeSnapshot(root, env);
    const outcome = await runShift({ root, client: deadClient, env });
    assert.equal(outcome.folded, true);
    assert.equal(outcome.reason, "no-changes");
    assert.equal(outcome.modelChars, 0);
  } finally {
    await cleanup();
  }
});

test("without a snapshot the before comes from git HEAD (concern #3 fallback)", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    // no takeSnapshot — simulate a session that never ran the SessionStart hook
    await writeFile(join(root, "a.ts"), `export function util(): number { return 3; }\n`);
    const outcome = await runShift({ root, client: deadClient, env });
    assert.equal(outcome.folded, false);
    assert.equal(outcome.beforeSource, "git-head");
    assert.deepEqual(outcome.changedPaths, ["a.ts"]);
    assert.equal(outcome.slice?.affectedFiles[0]?.path, "b.ts");
  } finally {
    await cleanup();
  }
});

test("a deleted file keeps its dependents (the before-model rule)", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await takeSnapshot(root, env);
    await unlink(join(root, "a.ts"));
    const outcome = await runShift({ root, client: deadClient, env });
    assert.equal(outcome.folded, false);
    assert.deepEqual(outcome.changedPaths, ["a.ts"]); // gone, but still the seed
    assert.equal(outcome.slice?.affectedFiles[0]?.path, "b.ts");
  } finally {
    await cleanup();
  }
});

test("a stale snapshot for a different root is ignored, not trusted", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    // hand-write a snapshot whose root does not match
    const id = workspaceIdFor([root]);
    const path = snapshotPath(id, env);
    await mkdir(join(workspaceDir(id, env)), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, root: "/somewhere/else", workspaceId: id, fileHashes: {}, repoFiles: { repo: "x", files: [] }, takenAt: "2026-01-01T00:00:00Z" }));
    await writeFile(join(root, "a.ts"), `export function util(): number { return 4; }\n`);
    const outcome = await runShift({ root, client: deadClient, env });
    assert.equal(outcome.beforeSource, "git-head"); // fell back instead of mis-diffing
  } finally {
    await cleanup();
  }
});

test("card opener respects quiet mode and env opt-out", async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = [];
  const opener = async (command: string, args: readonly string[]): Promise<void> => {
    calls.push({ command, args });
  };
  const htmlPath = join(tmpdir(), "mappamind-card.html");

  assert.equal(await maybeOpenShiftCard({ htmlPath, quiet: true, opener, platform: "darwin" }), false);
  assert.equal(calls.length, 0);

  assert.equal(
    await maybeOpenShiftCard({
      htmlPath,
      env: { ...process.env, MAPPAMIND_OPEN: "0" },
      opener,
      platform: "darwin"
    }),
    false
  );
  assert.equal(calls.length, 0);

  assert.equal(await maybeOpenShiftCard({ htmlPath, opener, platform: "darwin" }), true);
  assert.equal(
    await maybeOpenShiftCard({ htmlPath, quiet: true, forceOpen: true, opener, platform: "darwin" }),
    true
  );
  assert.deepEqual(calls, [
    { command: "open", args: [fileUrlForPath(htmlPath)] },
    { command: "open", args: [fileUrlForPath(htmlPath)] }
  ]);
});

// The Stop-hook contract: Codex parses a Stop hook's stdout as JSON and rejects
// plain text. `mappamind shift --hook` must therefore keep stdout to a single
// JSON object and route every human line to stderr.
test("shift --hook: stdout is one JSON object, human text goes to stderr", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await takeSnapshot(root, env);
    // A real change with a downstream dependent — non-cosmetic, so a card renders.
    await writeFile(join(root, "a.ts"), `export function util(): number { return 99; }\n`);

    const cli = fileURLToPath(new URL("./mappamind.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "shift", root, "--no-model", "--hook"], {
      encoding: "utf8",
      env: { ...env, MAPPAMIND_OPEN: "0" }
    });

    assert.equal(result.status, 0, result.stderr);
    // stdout is exactly one parseable JSON object — nothing else.
    const trimmed = result.stdout.trim();
    const parsed = JSON.parse(trimmed) as { systemMessage?: string };
    assert.equal(trimmed.split("\n").length, 1, "stdout is a single line of JSON");
    assert.ok(parsed.systemMessage, "carries a systemMessage");
    assert.ok(parsed.systemMessage!.includes("file://"), "with the card URL");
    // No human prose leaked onto stdout; it belongs on stderr.
    assert.ok(!result.stdout.includes("  card:"), "no plain card line on stdout");
    assert.ok(result.stderr.includes("card:"), "human summary is on stderr");
  } finally {
    await cleanup();
  }
});

test("shift --hook: a cosmetic fold stays silent with an empty JSON object", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await takeSnapshot(root, env);
    // A leaf nothing depends on — folds as cosmetic, no card.
    await writeFile(join(root, "leaf.ts"), `export const alone = 7;\n`);

    const cli = fileURLToPath(new URL("./mappamind.js", import.meta.url));
    const result = spawnSync(process.execPath, [cli, "shift", root, "--no-model", "--hook"], {
      encoding: "utf8",
      env: { ...env, MAPPAMIND_OPEN: "0" }
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), {}, "empty object, no popup");
    assert.ok(result.stderr.includes("folded"), "fold reason on stderr");
  } finally {
    await cleanup();
  }
});

test("a non-cosmetic shift archives the card and refreshes the app index", async () => {
  const { root, env, cleanup } = await makeRepo();
  try {
    await takeSnapshot(root, env);
    // A baseline must exist for the index's Studio/Capabilities tabs to render.
    const workspaceId = workspaceIdFor([root]);
    await writeBaseline(
      workspaceId,
      {
        schemaVersion: 1,
        workspaceId,
        derivedFrom: { factsHash: "seed" },
        capabilities: [
          { id: "c", name: "Core", summary: "does things", members: [{ repo: "repo", file: "a.ts" }], provenance: "derived", confidence: "high" }
        ],
        edges: [],
        unknowns: []
      },
      env
    );

    await writeFile(join(root, "a.ts"), `export function util(): number { return 7; }\n`);
    const outcome = await runShift({ root, client: deadClient, env });
    assert.equal(outcome.folded, false);

    const shiftDir = join(root, ".mappamind", "shift");
    const archived = (await readdir(shiftDir)).filter((f) => f.endsWith(".html") && f !== "latest.html");
    assert.equal(archived.length, 1, "one archived card written");
    assert.ok(existsSync(join(shiftDir, "latest.html")), "latest.html still written");

    // The ledger row points at the archived card.
    const ledger = await readFile(join(workspaceDir(workspaceId, env), "shifts.jsonl"), "utf8");
    const last = JSON.parse(ledger.trim().split("\n").pop()!) as { cardFile?: string };
    assert.equal(last.cardFile, archived[0]);

    // The app index regenerated as the tabbed app, listing this session.
    const index = await readFile(join(root, ".mappamind", "index.html"), "utf8");
    assert.ok(index.includes('id="tab-shifts"'), "index is the tabbed app");
    assert.ok(index.includes(outcome.card!.title), "shifts tab lists this session");
  } finally {
    await cleanup();
  }
});
