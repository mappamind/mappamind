import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  claudeHooksConfig,
  codexHooksConfig,
  hookCommand,
  installClaudeHooks,
  installCodexHooks,
  removeClaudeHooks,
  removeCodexHooks,
  removeCommandHook,
  upsertCommandHook
} from "./hookConfig.js";

test("hookCommand builds the bare guarded form (the static plugin / manual install)", () => {
  const cmd = hookCommand({ kind: "shift", host: "claude", guard: true });
  assert.match(cmd, /^if command -v mappamind >\/dev\/null 2>&1; then mappamind shift /);
  assert.ok(cmd.includes("--host claude"), "shift carries its host");
  assert.ok(!cmd.includes("--hook"), "the Claude shift hook stays plain");
  assert.ok(cmd.includes("else echo") && cmd.includes(">&2; fi"), "missing-binary hint goes to stderr");
});

test("hookCommand builds the nvm-proof absolute form when given a binPath", () => {
  const cmd = hookCommand({ kind: "shift", host: "codex", hook: true, guard: true, binPath: "/opt/mappamind" });
  assert.ok(cmd.includes(`[ -x "/opt/mappamind" ]`), "guards on the absolute path");
  assert.ok(cmd.includes(`"/opt/mappamind" shift`), "runs the absolute binary");
  assert.ok(cmd.includes("--hook") && cmd.includes("--host codex"), "codex shift carries --hook and its host");
});

test("the snapshot command never carries --host (it makes no model call)", () => {
  const claudeSnap = hookCommand({ kind: "snapshot", guard: true });
  const codexSnap = hookCommand({ kind: "snapshot", guard: true });
  assert.ok(!claudeSnap.includes("--host") && !codexSnap.includes("--host"));
  assert.ok(claudeSnap.includes("mappamind snapshot"));
});

test("claudeHooksConfig: snapshot on SessionStart, host-tagged shift on Stop, both guarded", () => {
  const claude = claudeHooksConfig() as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
  const start = claude.hooks.SessionStart?.[0]?.hooks[0]?.command ?? "";
  const stop = claude.hooks.Stop?.[0]?.hooks[0]?.command ?? "";
  assert.ok(start.includes("mappamind snapshot") && !start.includes("--host"), "snapshot, no host");
  assert.ok(stop.includes("mappamind shift") && stop.includes("--host claude"), "shift, host claude");
  assert.ok(stop.includes("command -v mappamind"), "guarded");
  assert.ok(!stop.includes("--hook"), "Claude shift stays plain (no JSON-stdout mode)");
});

test("codexHooksConfig: startup|resume matcher, --hook JSON mode, statusMessage/timeout, no host on snapshot", () => {
  const codex = codexHooksConfig() as {
    hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string; statusMessage?: string; timeout?: number }> }>>;
  };
  const start = codex.hooks.SessionStart?.[0];
  const stop = codex.hooks.Stop?.[0]?.hooks[0];
  assert.equal(start?.matcher, "startup|resume");
  assert.ok((start?.hooks[0]?.command ?? "").includes("mappamind snapshot"));
  assert.ok(!(start?.hooks[0]?.command ?? "").includes("--host"), "snapshot never gets --host");
  assert.equal(start?.hooks[0]?.statusMessage, "Mappamind: recording the before snapshot");
  assert.ok((stop?.command ?? "").includes("--hook"), "codex Stop runs JSON-stdout mode");
  assert.ok((stop?.command ?? "").includes("--host codex"));
  assert.equal(stop?.statusMessage, "Mappamind: rendering the shift card");
  assert.equal(stop?.timeout, 600);
});

test("upsertCommandHook replaces an existing mappamind shift hook (any variant) by subcommand", () => {
  const updated = upsertCommandHook(
    [{ hooks: [{ type: "command", command: "mappamind shift --quiet" }] }],
    { type: "command", command: "if command -v mappamind; then mappamind shift X --host claude; fi" },
    "shift"
  ) as Array<{ hooks: Array<{ command: string }> }>;
  assert.equal(updated.length, 1);
  assert.ok(updated[0]?.hooks[0]?.command.includes("--host claude"));
});

test("removeCommandHook removes every mappamind shift variant and keeps unrelated hooks", () => {
  const updated = removeCommandHook(
    [
      { hooks: [{ type: "command", command: "mappamind shift --quiet" }] },
      { hooks: [{ type: "command", command: "if command -v mappamind; then mappamind shift X; fi" }, { type: "command", command: "echo keep" }] },
      { hooks: [{ type: "command", command: "echo only" }] }
    ],
    "shift"
  ) as Array<{ hooks: Array<{ command: string }> }>;
  assert.deepEqual(
    updated.map((entry) => entry.hooks.map((hook) => hook.command)),
    [["echo keep"], ["echo only"]]
  );
});

test("installers merge into existing project hook files and are idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-hooks-"));
  try {
    await mkdir(join(root, ".claude"), { recursive: true });
    await writeFile(
      join(root, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo keep" }] }] } }),
      "utf8"
    );

    const claudePath = await installClaudeHooks(root);
    await installClaudeHooks(root); // second install must not duplicate
    const claude = JSON.parse(await readFile(claudePath, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    assert.equal(claude.hooks.Stop?.length, 2, "kept the unrelated hook, added exactly one shift hook");
    const shiftCmd = claude.hooks.Stop?.[1]?.hooks[0]?.command ?? "";
    assert.ok(shiftCmd.includes("mappamind shift") && shiftCmd.includes("--host claude"));

    const codexPath = await installCodexHooks(root);
    await installCodexHooks(root);
    const codex = JSON.parse(await readFile(codexPath, "utf8")) as {
      hooks: Record<string, Array<{ matcher?: string; hooks: Array<{ command: string }> }>>;
    };
    assert.equal(codex.hooks.SessionStart?.length, 1, "codex snapshot not duplicated");
    assert.equal(codex.hooks.SessionStart?.[0]?.matcher, "startup|resume");
    assert.ok((codex.hooks.Stop?.[0]?.hooks[0]?.command ?? "").includes("--hook"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installing with a binPath writes the nvm-proof absolute, guarded command", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-hooks-abs-"));
  try {
    const path = await installClaudeHooks(root, "/opt/mappamind/dist/mappamind.js");
    const cmd =
      (JSON.parse(await readFile(path, "utf8")) as { hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } }).hooks
        .Stop[0]?.hooks[0]?.command ?? "";
    assert.ok(cmd.includes(`[ -x "/opt/mappamind/dist/mappamind.js" ]`), "guards on the absolute path");
    assert.ok(cmd.includes(`"/opt/mappamind/dist/mappamind.js" shift`) && cmd.includes("--host claude"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removers do not create config files when none existed", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-hooks-noop-"));
  try {
    const claudePath = await removeClaudeHooks(root);
    const codexPath = await removeCodexHooks(root);
    assert.equal(existsSync(claudePath), false, "no .claude/settings.json conjured");
    assert.equal(existsSync(codexPath), false, "no .codex/hooks.json conjured");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hook removers delete project-level Mappamind hooks without touching other hooks", async () => {
  const root = await mkdtemp(join(tmpdir(), "mappamind-hooks-remove-"));
  try {
    await installClaudeHooks(root);
    await installCodexHooks(root);

    const claudePath = join(root, ".claude", "settings.json");
    const claudeBefore = JSON.parse(await readFile(claudePath, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    assert.ok(claudeBefore.hooks.Stop);
    claudeBefore.hooks.Stop.push({ hooks: [{ command: "echo keep" }] });
    await writeFile(claudePath, JSON.stringify(claudeBefore), "utf8");

    const removedClaudePath = await removeClaudeHooks(root);
    const claude = JSON.parse(await readFile(removedClaudePath, "utf8")) as { hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>> };
    assert.equal(claude.hooks.SessionStart, undefined);
    assert.deepEqual(claude.hooks.Stop?.map((entry) => entry.hooks[0]?.command), ["echo keep"]);

    const removedCodexPath = await removeCodexHooks(root);
    const codex = JSON.parse(await readFile(removedCodexPath, "utf8")) as { hooks: Record<string, unknown> };
    assert.deepEqual(codex.hooks, {});
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
