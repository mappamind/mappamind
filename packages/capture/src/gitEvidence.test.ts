import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { captureGitStatus, captureProjectFiles, createGitStatusEvidence, resolveGitRoot } from "./gitEvidence.js";
import { runGit } from "./gitCommand.js";

test("resolveGitRoot and captureGitStatus use real git evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-git-"));

  try {
    const init = await runGit(["init"], { cwd: root });
    assert.equal(init.exitCode, 0);

    await writeFile(join(root, "example.txt"), "hello\n", "utf8");

    const canonicalRoot = await realpath(root);
    const resolved = await resolveGitRoot(root);
    const status = await captureGitStatus(root);

    assert.equal(resolved.gitRoot, canonicalRoot);
    assert.equal(status.gitRoot, canonicalRoot);
    assert.match(status.porcelain, /\?\? example\.txt/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("capture ignores generated and vendor folders for scalable local evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-git-ignore-"));

  try {
    const init = await runGit(["init"], { cwd: root });
    assert.equal(init.exitCode, 0);

    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "dist"), { recursive: true });
    await mkdir(join(root, "vendor"), { recursive: true });
    await writeFile(join(root, "src", "app.ts"), "export const app = true;\n", "utf8");
    await writeFile(join(root, "dist", "bundle.js"), "export const generated = true;\n", "utf8");
    await writeFile(join(root, "vendor", "lib.ts"), "export const vendored = true;\n", "utf8");

    const status = await captureGitStatus(root);
    const project = await captureProjectFiles(root);

    assert.match(status.porcelain, /src\/app\.ts/);
    assert.doesNotMatch(status.porcelain, /dist\/bundle\.js|vendor\/lib\.ts/);
    assert.deepEqual(project.files.map((file) => file.path), ["src/app.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("captureProjectFiles reads non-JS source (the v1 .dart bug) and reports coverage", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-git-langs-"));

  try {
    const init = await runGit(["init"], { cwd: root });
    assert.equal(init.exitCode, 0);

    await mkdir(join(root, "lib"), { recursive: true });
    await mkdir(join(root, "protos"), { recursive: true });
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "lib", "main.dart"), "void main() {}\n", "utf8");
    await writeFile(join(root, "protos", "demo.proto"), "service S {}\n", "utf8");
    await writeFile(join(root, "firebase.json"), "{}\n", "utf8");
    // a tiny binary asset that must be skipped, not read
    await writeFile(join(root, "assets", "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    const project = await captureProjectFiles(root);
    const captured = project.files.filter((file) => file.text !== undefined).map((file) => file.path);

    // the bug: a .dart file must now be captured
    assert.ok(captured.includes("lib/main.dart"), "expected lib/main.dart to be captured");
    assert.ok(captured.includes("protos/demo.proto"), "expected the proto contract to be captured");
    assert.ok(captured.includes("firebase.json"), "expected config to be captured");
    // the asset must not be read
    assert.ok(!captured.includes("assets/logo.png"), "expected the png asset to be skipped");

    // coverage is honest about what happened
    assert.ok(project.coverage, "expected a coverage report");
    const coverage = project.coverage!;
    assert.equal(coverage.captured, captured.length);
    const dart = coverage.byLanguage.find((entry) => entry.language === "dart");
    assert.ok(dart && dart.files === 1, "expected dart in the language breakdown");
    const assetSkip = coverage.skipped.find((entry) => entry.reason === "asset");
    assert.ok(assetSkip && assetSkip.files >= 1, "expected the asset to be counted as skipped");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("createGitStatusEvidence attaches repo and session metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-git-evidence-"));

  try {
    const init = await runGit(["init"], { cwd: root });
    assert.equal(init.exitCode, 0);

    const event = await createGitStatusEvidence({
      eventId: "evt_1",
      repoId: "repo_1",
      sessionId: "session_1",
      cwd: root,
      timestamp: "2026-06-04T00:00:00.000Z"
    });

    assert.equal(event.eventId, "evt_1");
    assert.equal(event.repoId, "repo_1");
    assert.equal(event.sessionId, "session_1");
    assert.equal(event.source, "git");
    assert.equal(event.eventType, "git_status_snapshot");
    assert.equal(event.timestamp, "2026-06-04T00:00:00.000Z");
    assert.equal(event.payload?.gitRoot, await realpath(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
