import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { claudeHooksConfig } from "./hookConfig.js";

// Validates the Claude Code plugin packaging wires up end to end: the root
// marketplace points at the plugin dir, the plugin manifest references a hooks
// file that exists, and that hooks file equals the generator. A broken path or a
// hand-edited hooks file fails here instead of at a user's `/plugin install`.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function readJson(rel: string): any {
  return JSON.parse(readFileSync(resolve(ROOT, rel), "utf8"));
}

test("marketplace.json points at a plugin dir that has a manifest", () => {
  const market = readJson(".claude-plugin/marketplace.json");
  assert.equal(market.name, "mappamind", "marketplace id drives `/plugin install mappamind@mappamind`");
  const entry = market.plugins[0];
  assert.equal(entry.name, "mappamind");
  assert.equal(entry.source, "./plugins/mappamind");
  assert.ok(
    existsSync(resolve(ROOT, "plugins/mappamind/.claude-plugin/plugin.json")),
    "the plugin source dir carries a .claude-plugin/plugin.json"
  );
});

test("plugin.json references an existing hooks file equal to the generator", () => {
  const manifest = readJson("plugins/mappamind/.claude-plugin/plugin.json");
  assert.equal(manifest.name, "mappamind");
  const hooksPath = resolve(ROOT, "plugins/mappamind", manifest.hooks);
  assert.ok(existsSync(hooksPath), `manifest hooks path resolves: ${manifest.hooks}`);
  assert.equal(
    readFileSync(hooksPath, "utf8"),
    `${JSON.stringify(claudeHooksConfig(), null, 2)}\n`,
    "the Claude plugin hooks file must match `npm run gen:hooks`"
  );
});
