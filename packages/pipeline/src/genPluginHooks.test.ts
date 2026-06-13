import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { claudeHooksConfig, codexHooksConfig } from "./hookConfig.js";

// The drift guard. The static plugin hooks files are GENERATED from hookConfig by
// `npm run gen:hooks`; this test fails if a committed file no longer matches the
// generator — the exact drift that broke Codex Stop hooks once (hook-template-drift).
// Repo root from packages/pipeline/dist/genPluginHooks.test.js → up three dirs.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function committed(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

function generated(config: Record<string, unknown>): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

test("committed Codex plugin hooks equal the generator (run `npm run gen:hooks` to fix)", () => {
  assert.equal(committed("plugins/mappamind/hooks/hooks.json"), generated(codexHooksConfig()));
});

test("committed Claude plugin hooks equal the generator (run `npm run gen:hooks` to fix)", () => {
  assert.equal(committed("plugins/mappamind/hooks/claude-hooks.json"), generated(claudeHooksConfig()));
});
