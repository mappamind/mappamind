# Contributing to Mappamind

Thanks for helping make Mappamind the obvious answer to "what did my agent just do?"
Issues, ideas, and pull requests are all welcome.

## Setup

Requirements: **Node 20+** and a model CLI on your `PATH` (`claude` or `codex`) if you
want to exercise grounded synthesis locally.

```sh
git clone https://github.com/mappamind/mappamind
cd mappamind
npm install
```

## Build

This is an ESM TypeScript monorepo built with project references:

```sh
npm run build      # tsc -b across all packages
```

To run the CLI against a repo from your working copy:

```sh
npm link -w @mappamind_/pipeline
mappamind status "$(pwd)"
```

## Test

```sh
npm test           # node:test across all packages
```

Please keep the suite green and add tests with any behavior change — especially a
regression test when you fix a bug.

## Where to contribute

- **Language / framework coverage.** New coverage is a **prompt + a schema, never a new
  framework catcher** (the anti-treadmill rule). If you find a gap, open a
  [coverage issue](https://github.com/mappamind/mappamind/issues/new/choose) describing
  the shape rather than hardcoding a pattern.
- **False positives / confusing cards.** A card that overstated impact, fired on a
  cosmetic change, or stated a claim you couldn't trace to code is a real bug — report it.
- **Rendering and the Studio.** Improvements to the cards, mesh, and Studio. Rendered
  surfaces must stay self-contained: **no `<script>`, no external assets** (enforced by
  `assertOfflineSafe`).
- **Docs.** Clarity for first-time users is always welcome.

Read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** first — it explains the layers and
where things live. The **[Roadmap](docs/ROADMAP.md)** lists what's next.

## The one rule that matters: grounding (the leash)

**Every intelligent output must cite a real code fact, or it is dropped.**

A claim on a card or in the Studio is only allowed to exist if it points at a real
`file:line` in the user's code. The model cannot invent an endpoint, a dependency, or a
contract. When the evidence isn't there, Mappamind stays quiet rather than inventing
architecture. Any change that lets an unsupported claim reach a rendered surface is a
regression, no matter how plausible the claim sounds.

If your contribution adds a new kind of claim, it must come with the grounding path that
backs it — and a test that proves an unsupported version is dropped.

## Pull requests

1. Branch off `main`.
2. Keep the change focused; one concern per PR.
3. `npm run build` and `npm test` both pass.
4. Describe what changed and, for behavior changes, how you verified it.

By contributing you agree your contributions are licensed under the [MIT License](LICENSE).
