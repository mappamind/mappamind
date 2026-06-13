# Architecture

Mappamind builds an evidence-grounded model of a codebase, and when an agent
session changes it, renders a before/after picture of what moved. Every claim in
that picture cites a real code fact or it is dropped: the model can never invent
an edge or an endpoint, because both ends of every edge come from facts the
extractor found in the code. This document describes how the system works.

## The two moments

Mappamind runs at two moments. It builds a **baseline** of what the system is,
then on every agent session it computes the **shift**: what the agent just did.

### Baseline — the "before"

Built once, refreshed only when the structure changes.

```
  repo(s) ─▶ @capture ─▶ @extractors (tree-sitter facts) ─┬─▶ code graph (file-level)
                                                          ├─▶ @seam (cross-boundary
                                                          │        contracts)
                                                          └─▶ @synthesis (a model CLI
                                                                   proposes capabilities)
                                                                       │ PROPOSED
                                                                       ▼
                                              ▶▶ THE LEASH ◀◀  groundBaseline: cite a
                                                 real fact or DROP
                                                                       │ GROUNDED
                                                                       ▼
                          @store   baseline.json · seams.json · channels cache
                          $XDG_STATE_HOME/mappamind/workspaces/<id>/
```

### Shift — the accept moment

Runs at the end of every agent session, off a `Stop` hook.

```
  agent session ENDS ─▶ [Claude Code / Codex `Stop` hook]
        │
        ▼  @capture · captureGitDiff → changedPaths
  @impact · computeBlastRadius   reverse traversal over the code graph
        │   → affectedFiles (every real dependent, none invented)
        │   → affectedCapabilities · brokenContracts
        │   → cosmetic? (nothing downstream hit)
        ├── cosmetic → FOLD, no alarm
        └── real ─▶ @impact · narrateShift (a model CLI on the SLICE ONLY)
                        ▶▶ LEASH ◀◀ may only cite nodes in the slice; drop invented
                        │ ShiftCard
                        ▼
                  renderShiftCard  →  BEFORE ▸ AFTER picture (changed/affected in red)
                        │
                        ▼
                  human sees it in-session, and decides whether to accept the
                  change in their agent. The card informs the call; it does not
                  capture it.
```

## The leash

Every intelligent output (capabilities, edges, contracts, shift narration) runs
one unit: **facts → propose → ground → keep.** The model proposes; a citation to
a real code fact is required, or the proposal is dropped. Both ends of any edge
come from real facts by construction, so the model can never invent an endpoint.

This is what lets a human accept or reject on the picture: it is exactly correct,
never a plausible lie about the architecture. The accept/reject happens in the
agent host; the card's job is to make that call well-informed.

## The deterministic floor and the LLM ceiling

The system splits in two, with a hard rule about which half grows when you add a
language or a medium.

```
  CEILING — THE LEASH (LLM)              ← ALL new coverage lives here.
    • comprehension (capabilities / flows)   New language? New medium? New
    • seam adjudication (any medium)          framework next year? = a prompt +
    • shift narration                         a schema. Never new code.
         ▲  grounded: cite a REAL fact or DROP
         │
  ─────────────────────────────────────────────────────────────────────
         │  facts + candidates fed up
  FLOOR — DETERMINISTIC (bounded)        ← does not grow per medium.
    • extractors: tree-sitter facts (17 languages)
    • ONE generic candidate rule (a key "used" in one boundary,
      "provided" in another — works for REST, queues, RPC, data, ...)
    • the code graph + blast-radius traversal
```

The extractors do not understand anything. They parse source into structure and
pull facts every language already has: symbols, imports, calls, strings.
Grammars ship with `tree-sitter-wasms`; adding a language is a small, one-time
query file. The seam-convention mechanism survives as optional, project-supplied
DATA, but ships with no entries: technology recognition is the model's job, not a
hardcoded shape. New medium coverage comes from the one generic candidate rule,
the model adjudicating it, and the verifier's deterministic role gate — never a
new convention or catcher.

The rule, in one line: the deterministic floor extracts and proposes; the LLM
leash understands and decides. New coverage is always a prompt, never a catcher.

## The code graph and blast radius

The code graph is built directly from tree-sitter facts: files are nodes, and
imports and calls are edges. There is no external graph database and no symbol
index service. `computeBlastRadius` runs a reverse traversal from the changed
files to find every real dependent, then `diffServiceGraphs(before, after)`
reports broken contracts (a dangling consumer whose contract matches a lost edge
is a proven internal break). Cost is bounded by the change: `narrateShift` only
ever sees the affected slice, not the whole repo.

## Synthesis and the model CLI

`@synthesis` shells out to a model CLI already on `PATH` (`claude` or `codex`)
for the parts that require comprehension. There is no API key and no SDK
dependency; the only external runtime dependency in the whole tree is
`web-tree-sitter` plus its WebAssembly grammars. A cosmetic change never calls
the model at all.

## Rendered output

Cards and the Studio are a single self-contained HTML file: no `<script>`, no
external assets, no network. They open offline and travel as one file. The
renderer enforces this — the only external link allowed is the feedback URL.

## Packages

```
packages/
  capture/      fs watcher + git
  extractors/   tree-sitter facts, 17 languages
  baseline/     THE LEASH — propose → ground → keep
  seam/         cross-boundary contracts + the service mesh
  impact/       the blast radius (computeBlastRadius, diffServiceGraphs, narrateShift)
  synthesis/    grounded capability synthesis via a model CLI
  store/        structured JSON/JSONL persistence
  scoring/      precision/recall/citation harness
  pipeline/     composition root + the Studio render + the mappamind CLI
  ledger/       append-only evidence/shift history
  core/         shared primitives
  mappamind/    thin wrapper — the published mappamind bin
```
