# Repository Guidelines

## Project Structure & Module Organization

Mappamind is an open-source TypeScript/ESM npm workspace. Source lives in `packages/*/src`: `capture` for file/git evidence, `extractors` for language facts, `baseline` for grounded models, `seam` for contracts, `impact` for blast radius, `synthesis` for Claude-backed synthesis, `store`/`ledger` for persistence, `pipeline` for CLI/composition, and `core` for shared types/config. Tests sit beside source as `*.test.ts`. See `docs/ARCHITECTURE.md` for design and architecture context.

## Build, Test, and Development Commands

- `npm install` installs workspace dependencies. Use Node 20+.
- `npm run build` runs `tsc -b` across the project references and emits `dist/`.
- `npm test` builds, then runs `node --test` against compiled `packages/**/dist/**/*.test.js`.
- `npm run clean` removes TypeScript build outputs via `tsc -b --clean`.
- `mappamind status <root>` reports repo/workspace discovery, baseline freshness, Studio URL, and duplicate hook warnings.
- `mappamind setup <root> --host claude --yes` runs the first grounded baseline with Claude Code and writes `.mappamind/index.html`. Use `--host codex` when running setup through Codex.
- Package-local commands, such as `npm test -w @mappamind_/impact`, run one workspace after build output exists.

`synthesis` shells out to `claude -p`, so related workflows require a local Claude CLI setup.

## Coding Style & Naming Conventions

Use strict TypeScript with `NodeNext` modules and explicit `.js` extensions in relative imports. Prefer named exports from `src/index.ts` barrels. Follow existing formatting: two-space indentation, double quotes, semicolons, `camelCase` values, `PascalCase` types, and descriptive filenames. Shared primitives belong in `@mappamind_/core`.

## Testing Guidelines

Tests use Node's built-in `node:test` with `node:assert/strict`. Name tests `*.test.ts` next to the code they cover, and assert exact behavior. Add or update tests for changes to extraction, grounding, seam detection, impact computation, persistence, or CLI rendering. Run `npm test` before handing off.

## Commit & Pull Request Guidelines

Git history uses scoped subjects such as `impact: Phase 2b — narrateShift...` and `docs: HANDOFF — add A6...`. Keep commits focused and start with the affected area (`pipeline:`, `design:`, `docs:`, `capture:`). PRs should include a problem/solution summary, linked issue or plan reference, test results, and screenshots or HTML paths for user-visible changes.

## Agent-Specific Instructions

This repo is shared by Claude Code and Codex. First-run knowledge discovery is explicit: run `mappamind status <root>` and, if the baseline is missing or stale, ask before `mappamind setup <root> --host claude --yes` (or `--host codex`) because it scans the workspace and calls the selected local model CLI. Baselines are local to the repo/workspace path, not to each git branch; checking out another branch can make the stored baseline stale, but shift cards still compare session start to session end. `setup` writes the Studio and prints `studio: file://...`. `mappamind hooks --install` writes Claude hooks to `.claude/settings.json` and Codex hooks to `.codex/hooks.json`; both run `mappamind snapshot` at `SessionStart` and `mappamind shift` at `Stop`. Hook roots may be a git repo or a parent workspace containing git repos; workspace paths are shown as `repo/path`. Codex users must review/trust project hooks with `/hooks`. If the Codex plugin is installed, use plugin hooks or project hooks, not both; remove project Codex hooks with `mappamind hooks --remove --agent codex`. The card URL appears as `card: file://...` in command output, and agent skills should include that URL in the final response when they run `mappamind shift` before handoff. Read `docs/ARCHITECTURE.md` before larger changes.

## Security & Configuration Tips

Do not commit local `.mappamind/` output, credentials, or machine-specific Claude config. Keep generated `dist/` artifacts out of reviews unless release work asks for them. Prefer typed config helpers in `packages/core/src/config`.
