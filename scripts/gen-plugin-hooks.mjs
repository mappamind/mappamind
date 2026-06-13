// Generate the static plugin hooks files from the single hookCommand source of
// truth (packages/pipeline/src/hookConfig.ts). These committed files are what the
// Claude and Codex plugin packages ship; a CI test (genPluginHooks.test.ts)
// asserts they equal this generator's output, so a hand edit to one copy can
// never silently drift from the builder (the hook-template-drift class).
//
// Run: `npm run gen:hooks` (builds first, then writes the files).
//
// The plugin files use the BARE + guarded command form (no machine path) — only
// `mappamind hooks --install` writes absolute, nvm-proof paths into a user's repo.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dist = resolve("packages/pipeline/dist/hookConfig.js");
const { claudeHooksConfig, codexHooksConfig } = await import(pathToFileURL(dist).href);

const targets = [
  ["plugins/mappamind/hooks/hooks.json", codexHooksConfig()],
  ["plugins/mappamind/hooks/claude-hooks.json", claudeHooksConfig()]
];

for (const [rel, config] of targets) {
  const path = resolve(rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  console.log("wrote", rel);
}
