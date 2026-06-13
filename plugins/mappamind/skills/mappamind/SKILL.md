---
name: mappamind
description: Use Mappamind to set up the first workspace baseline, snapshot before an AI coding agent session, render the shift card after changes, and include local Studio/card URLs in the final response.
---

# Mappamind

Use this skill when a user wants Mappamind enabled for a repo/workspace, asks for the initial architecture map, wants an impact card for an AI coding agent session, asks to inspect what the agent changed, or explicitly invokes Mappamind.

## Workflow

1. Check Mappamind status for the current git repo or parent workspace:

```sh
mappamind status "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" --json
```

2. If the command is missing, tell the user to install the CLI:

```sh
npm i -g mappamind-cli
```

3. If status reports `baseline.state` as `missing` or `stale`, ask the user before running the expensive initial map. After approval, run:

```sh
mappamind setup "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" --host claude --yes
```

If setup prints `studio: file://...`, include that URL in the response under `Mappamind Studio`.

Baselines are local to the repo/workspace path, not to each git branch. A branch checkout can make the stored baseline stale; shifts still compare the session-start snapshot to the session-end tree.

4. Before making code edits in a session, run:

```sh
mappamind snapshot "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

5. After meaningful code changes and before the final response, run:

```sh
mappamind shift "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
```

6. If the command prints `card: file://...`, include that URL in the final response under `Mappamind card`.

7. If the command folds the card, report the folded reason instead of inventing an impact.

8. If browser opening fails, still relay the `file://` URL. The Studio is one self-contained app at `.mappamind/index.html` with four tabs (Studio, Shifts, Capabilities, Contracts) — no server, no scripts. A non-cosmetic shift card is written at `.mappamind/shift/latest.html` and archived per session at `.mappamind/shift/<timestamp>.html`; the Shifts tab links to every archived card.

## Notes

- Platform-specific packages can bundle lifecycle hooks; users may need to review or trust those hooks in their agent.
- If `status.hooks.warnings` mentions duplicate Codex project hooks, tell the user to run `mappamind hooks --remove --agent codex` in the target root.
- Opening can be suppressed with `MAPPAMIND_OPEN=0`.
- Mappamind depends on the `mappamind` CLI being available on `PATH`.
