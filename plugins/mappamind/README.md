# Mappamind Plugin

This plugin packages Mappamind for AI coding-agent sessions:

- `mappamind` skill: runs `mappamind status`, guides first baseline setup, and tells the agent to include local URLs in its response.
- `SessionStart` hook: runs `mappamind snapshot <root>`.
- `Stop` hook: runs `mappamind shift <root>`, prints `card: file://...`, and opens the card unless `MAPPAMIND_OPEN=0`.
- `<root>` can be a git repo or a workspace directory containing git repos.
- First setup writes the Studio to `.mappamind/index.html` and prints `studio: file://...`.
- Baselines are local to the repo/workspace path, not to each git branch. Branch changes can make the baseline stale; shift cards still compare session start to session end.

The plugin expects the `mappamind` CLI to be installed on `PATH`, for example with:

```sh
npm i -g mappamind
```

**Claude Code** installs this plugin from the marketplace, which wires the hooks for you.

**Codex** has no self-serve plugin marketplace yet, so install the hooks directly:

```sh
mappamind hooks --install --agent codex
```

Remove them with `mappamind hooks --remove --agent codex`. Don't run both a marketplace plugin and project hooks for the same host — that would fire twice.
