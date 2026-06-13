<div align="center">

<img src="assets/logo-mark.png" alt="Mappamind" width="116" />

### See what your AI coding agent just did to your system's behavior, flow, and architecture.

Grounded in real code. Visual. In-session, at the moment you decide whether to accept the change.

[![CI](https://github.com/mappamind/mappamind/actions/workflows/ci.yml/badge.svg)](https://github.com/mappamind/mappamind/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/mappamind.svg)](https://www.npmjs.com/package/mappamind)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](#requirements)

[Quickstart](#quickstart) · [Commands](#common-commands) · [Agent setup](#agent-setup) · [Storage](#storage-and-privacy) · [Coverage](#what-it-covers) · [Discussions](https://github.com/mappamind/mappamind/discussions)

</div>

---

As agents write more of the code, your job shifts from **author** to **supervisor** — and supervision is where the mental model breaks. You didn't write the change, so you can't feel what moved. A 40-file agent diff is unreadable as a line-diff.

Mappamind builds an evidence-grounded picture of your codebase's behavior, flow, and architecture. When an agent session shifts it, you get a **before/after picture** at the accept moment: an alarm that draws. Agent dashboards render text. Mappamind is the picture they are missing.

<div align="center">
<img src="docs/assets/shift-card.png" alt="A Mappamind shift card showing an agent rename from shipping to fulfillment that broke two callers, with the removed channel, cited proof lines, and a calls-flow diagram pointing checkout and storefront at the removed provider" width="820" />
</div>

## Why Mappamind

Every claim on the card is **grounded** — it cites a real code fact or it gets dropped. The model cannot invent an endpoint or a dependency; both ends of every edge come from facts in your code. That is what lets you accept or reject on the picture: it is exactly correct, never a plausible lie about your architecture.

- **At the accept moment, not at PR time.** The card fires from the agent-session boundary (a `Stop` hook), in-session, while the change is still in your hands.
- **Bounded by the change, not the repo.** A code graph shrinks the work to the affected slice, so cost and latency track the diff, not the codebase size.
- **No false alarms.** A comment or leaf-only change folds as cosmetic and never rings.
- **Self-contained output.** Cards and the Studio are a single HTML file: no server, no `<script>`, no external assets. Open offline, share as one file.

## What You Get

Mappamind writes one Studio file during setup, then adds shift cards when agent sessions change code:

```text
.mappamind/
├── index.html                 # Studio: mesh, shifts, capabilities, contracts
└── shift/
    ├── latest.html            # latest non-cosmetic shift card
    └── <timestamp>.html       # archived cards linked from the Studio
```

The durable baseline and channel cache live beside these files under `.mappamind/state/`. See [Storage and privacy](#storage-and-privacy).

## Install

```sh
npm i -g mappamind-cli
```

This installs the `mappamind` command. (The package is published as `mappamind-cli`; the command you run is `mappamind`.)

**Prerequisite:** a model CLI on your `PATH` — [Claude Code](https://claude.com/claude-code) (`claude`) or [Codex](https://developers.openai.com/codex) (`codex`). Mappamind shells out to the host you choose for grounded baseline synthesis and shift narration; no API key required.

> Trying it without installing? `npx -p mappamind-cli mappamind status <repo>` works for a quick look, but the lifecycle hooks invoke the bare `mappamind` binary, so hooks need the global install above.

## Quickstart

Five minutes from install to your first card.

```sh
# 1. Point Mappamind at a repo (or a parent folder of repos)
mappamind status .

# 2. Build the grounded baseline — the "before" picture
mappamind setup . --host claude --yes   # or: --host codex

# 3. Wire lifecycle hooks into supported agents
mappamind hooks --install

# 4. Run a normal agent session. When it ends, the Stop hook renders
#    the before/after card to .mappamind/shift/latest.html and opens it —
#    so you can decide whether to accept the change in your agent.
```

`mappamind setup` makes real model calls to synthesize grounded capabilities and adjudicate candidate channels, so it requires an explicit model host. If the selected host fails, setup stops without writing a baseline. On a small-to-medium repo that is usually seconds; larger repos cost more on first run. The CLI prints a progress estimate up front.

To refresh an existing baseline after structural changes, run:

```sh
mappamind setup . --host claude --force --yes
```

Use `--host claude` or `--host codex` every time you run setup. Agent skills should pass the host they are running under.

## Agent Setup

Mappamind is host-neutral at the CLI layer. Agents are just lifecycle triggers: `SessionStart` records the before snapshot, and `Stop` renders the shift card.

**Claude Code**

Install from the Claude marketplace:

```sh
/plugin marketplace add mappamind/mappamind
/plugin install mappamind@mappamind
```

The marketplace plugin includes the `mappamind` skill and lifecycle hooks.

**Codex**

Codex does not offer self-serve plugin publishing yet, so wire project hooks directly:

```sh
mappamind hooks --install --agent codex
```

This installs `SessionStart` and `Stop` hooks into the repo's `.codex/`. Review and trust them with `/hooks`. Remove them with:

```sh
mappamind hooks --remove --agent codex
```

Do not run both a plugin-bundled hook and a project hook for the same host; that would snapshot and shift twice.

### Plugin Skill

The plugin ships one skill:

| Skill | What it does |
|---|---|
| `mappamind` | Checks status, guides first baseline setup, snapshots before code edits, runs the shift card after meaningful changes, and tells the agent to include local Studio/card URLs in its final response. |

That is enough for the current product. Add more skills only when there is a distinct user workflow, such as benchmark evaluation, release packaging, or a future query/serve mode. Extra skills should not duplicate the lifecycle hook behavior.

## Common Commands

| Command | Use |
|---|---|
| `mappamind status <root>` | Discover repos, show baseline freshness, Studio URL, and hook warnings. |
| `mappamind setup <root> --host claude --yes` | Build the first grounded baseline and Studio with Claude Code. |
| `mappamind setup <root> --host codex --yes` | Build the first grounded baseline and Studio with Codex. |
| `mappamind setup <root> --host claude --force --yes` | Rebuild and replace an existing baseline, even if it is current. |
| `mappamind hooks <root> --install --agent all` | Install Claude Code and Codex project hooks. |
| `mappamind hooks <root> --remove --agent codex` | Remove only Codex project hooks. |
| `mappamind snapshot <root>` | Manually record the before snapshot for a session. |
| `mappamind shift <root>` | Manually render the current before/after card. |
| `mappamind shift <root> --no-model` | Render with deterministic fallback narration only. |
| `mappamind watch <root> --interval 30` | Polling mode for non-agent/manual editing sessions. |

`<root>` can be a git repo or a parent workspace containing multiple git repos. Multi-repo workspaces qualify paths as `repo/path`.

## Storage and Privacy

Mappamind stores two different classes of output:

| Output | Location | Commit it? |
|---|---|---|
| Studio and shift cards | `<root>/.mappamind/` | No. It is generated local output. |
| Durable baseline, channel cache, before snapshot, and shift history | `<root>/.mappamind/state/workspaces/<id>/` | No. It is generated local memory for that workspace. |

Set `MAPPAMIND_STATE_DIR=/path/to/state` to move the durable store, for example in tests or CI.

Baselines are local to the repo/workspace path, not to each git branch. Checking out another branch can make the stored baseline stale; `mappamind status` warns when the current structural facts no longer match it. Shift cards still work because they compare the session-start snapshot to the session-end tree. Run `mappamind setup . --host claude --force --yes` only when you want the current branch/worktree to become the standing Studio baseline.

The repository `.gitignore` should include:

```gitignore
.mappamind/
.claude/
.codex/
```

Mappamind reads source locally with tree-sitter and shells out to a model CLI already on your machine (`claude` or `codex`) for grounded synthesis and narration. It does not require API keys, and rendered HTML is self-contained: no network, no external assets, no scripts. Disable browser opening with:

```sh
MAPPAMIND_OPEN=0 mappamind shift .
```

## Cost and Latency

The first baseline is the expensive step because Mappamind reads the workspace and asks the model to synthesize grounded capabilities. Per-session shift cards are smaller: they diff against the before snapshot, traverse only the affected graph slice, fold cosmetic changes, and avoid model calls when nothing downstream is hit.

Today Mappamind re-reads the tree each session. For large repositories, `status`, `setup`, and `shift` print a large-repo advisory instead of hiding the cost. A token-usage chart belongs in benchmarks once the eval data is stable; until then, the README should avoid implying a precise cost curve.

## How it works

Four layers, from raw code facts to the picture you see:

| Layer | What |
|---|---|
| 4 · Conveyance | the **before/after picture**, in-session at the accept moment |
| 3 · Trigger | the **agent-session boundary** (Claude Code / Codex lifecycle hooks) |
| 2 · Leash | **grounded** comprehension — cite a real fact or drop; never lies |
| 1 · Code graph | blast-radius traversal over tree-sitter facts (imports → calls → contracts) |

The rule that keeps us off the per-language treadmill: **new coverage is always a prompt + a schema, never a framework catcher.**

Two moments:

```
BASELINE (the "before")               SHIFT (the accept moment)
repo ─▶ capture ─▶ extractors ─▶      agent session ENDS ─▶ [Stop hook]
   facts ─▶ leash (ground) ─▶            capture diff ─▶ blast radius
   the Studio: mesh, capabilities,        ├─ cosmetic? ─▶ fold, no alarm
   contracts, history                     └─ real ─▶ narrate (leashed) ─▶
                                              before/after card
```

The Studio is one page with four tabs — **Studio** (the service mesh), **Shifts** (session history), **Capabilities**, **Contracts** — switched with CSS-only tabs. Workspace cards qualify paths as `repo/path`, so a microservice suite or a web-app-plus-backend renders without name collisions.

## What it covers

Tree-sitter facts across **17 languages** out of the box (TypeScript, JavaScript, Go, Python, Java, C#, C, C++, PHP, Ruby, Rust, Kotlin, Swift, Scala, Dart, shell, and more). New language or framework coverage is a prompt and a schema, not new parsing code.

**Best for a service architecture.** Mappamind shines on repos where services call each other across a boundary — microservices, a frontend talking to a backend, a multi-repo workspace. It detects those cross-service channels from real code and stays quiet rather than invent a mesh when there isn't one. On a single in-process codebase or a monorepo of independent tools (where there's no service mesh to draw), it will tell you so instead of fabricating one — that's the design, but the picture there is naturally sparse.

See **[Coverage & support](docs/COVERAGE.md)** for the full language list, the repo and workspace shapes it handles, and the size limits.

## Requirements

- **Node 20 or newer.**
- A model CLI on `PATH`: `claude` or `codex`.
- **macOS and Linux** are supported. Windows is untested — the hooks use POSIX shell, so use WSL.
- Grammars are WebAssembly (no native compile on install).

## Troubleshooting

**`mappamind: command not found` inside hooks**

Install globally with `npm i -g mappamind-cli`, then reinstall hooks so they capture a stable binary path:

```sh
mappamind hooks --install
```

**Codex hooks do not run**

Run `/hooks` in Codex and trust the project hooks. If you also installed a Codex plugin later, remove project hooks:

```sh
mappamind hooks --remove --agent codex
```

**Baseline is stale**

That means the current structural facts no longer match the stored baseline. It can happen after structural edits or after checking out another branch. Shift cards still compare session start to session end; refresh intentionally when this branch/worktree should become the standing baseline:

```sh
mappamind setup . --host claude --force --yes
```

**No card appears**

Cosmetic shifts fold by design. Run `mappamind shift .` manually to see the fold reason, or set `MAPPAMIND_OPEN=0` in headless environments and use the printed `card: file://...` URL.

## Develop

```sh
npm install
npm run build
npm link -w @mappamind_/pipeline
mappamind status "$(pwd)"
npm test
```

Repo layout:

```
packages/
  capture/      fs watcher + git
  extractors/   tree-sitter facts, 17 languages
  baseline/     THE LEASH — propose → ground → keep
  seam/         cross-boundary contracts + the service mesh
  impact/       the blast radius (computeBlastRadius, diffServiceGraphs)
  synthesis/    grounded capability synthesis via a model CLI
  store/        structured JSON/JSONL persistence
  scoring/      precision/recall/citation harness
  pipeline/     composition root + the Studio render + the mappamind CLI
  ledger/       append-only evidence/shift history
  core/         shared primitives
  mappamind/    thin wrapper — the published `mappamind` bin
docs/
  ARCHITECTURE.md  how the system works (read first)
```

## Contributing & feedback

This is open source, and the goal is for Mappamind to be the obvious answer to "what did my agent just do?" Issues, ideas, and pull requests are welcome. Tell us what landed and what didn't in [**Discussions**](https://github.com/mappamind/mappamind/discussions) — especially: did a card make a real change's impact obvious at the accept moment?

The **[Roadmap](docs/ROADMAP.md)** lays out what's next and the rules to build it by; **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** explains how the system works (read it first).

### Contributors

<a href="https://github.com/mappamind/mappamind/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=mappamind/mappamind" alt="Mappamind contributors" />
</a>

## License

[MIT](LICENSE) © Mappamind contributors
