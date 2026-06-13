# Coverage & support

What Mappamind reads, the kinds of repositories it illuminates, and where it
deliberately stays quiet. The rule throughout: every claim cites a real code fact or it
is dropped — so Mappamind never invents an architecture that isn't there.

## Languages

Seventeen languages out of the box, parsed with tree-sitter:

**TypeScript · JavaScript · TSX/JSX · Go · Python · Java · C# · C · C++ · PHP · Ruby ·
Rust · Kotlin · Swift · Scala · Dart · Shell**

Adding a language is a one-time query file, not new analysis code — the deterministic
floor is language-agnostic.

## Repositories and workspaces

- **Single repository** — any git repo (or a plain folder).
- **Multi-repo workspace** — point Mappamind at a parent folder of several repos and it
  analyses them together, qualifying every path as `repo/path` so a microservice suite or
  a frontend-plus-backend renders without name collisions, and cross-repo calls are
  detected.

## What works on which surface

Mappamind has two surfaces, with different requirements:

| Surface | What it needs |
|---|---|
| **Shift card** — what an agent changed, and its blast radius | **Any** repository. Built on the import/call graph, so a monolith, a monorepo, or a microservice suite all get a useful before/after picture. |
| **Studio mesh & Contracts** — cross-service channels | A **service architecture** — services that call each other across a boundary. Richest on string-routed HTTP meshes. |
| **Capabilities** — what the system does | Most repositories; may be sparse on very large in-process monorepos. |

The shift card — what you see at the accept moment — works everywhere. The cross-service
mesh is where repository *shape* matters.

## Where the mesh shines, and where it stays quiet

The cross-service detector links services by **shared identifiers in real code** (an HTTP
route path, a queue topic, or a name declared in a shared contract file). That shapes its
coverage.

**Shines** — a real mesh, richly drawn:

- HTTP-route microservice meshes (services call each other by URL path)
- A frontend talking to a backend
- Multi-repo workspaces with cross-repo calls
- **Contract-declared RPC** — gRPC / OpenAPI where the contract artifact (a `.proto` or
  OpenAPI spec) is shared or co-located across the calling and serving sides: the services
  are linked by the declared service/method (or path), not a route string

**Runs safely, draws a sparse picture** — no false edges, no fabrication; it says so
plainly rather than inventing a mesh:

- **RPC by service _name_ with no shared contract file** (e.g. Spring Feign, or a gRPC
  consumer that references the `.proto` only through build config rather than a co-located
  copy) — the link is a bare service name with no declared-interface artifact to anchor on
- **Framework-abstracted events** (e.g. Kafka or NATS behind an event class or enum) — the
  topic is hidden, so no shared string co-occurs
- **In-process monoliths and monorepos** — the calls are function calls, not channels
- **Monorepos of independent units** — there is genuinely no cross-service mesh to draw

On these, Mappamind tells you it found no meaningful cross-service architecture instead of
guessing. Extending first-class coverage to RPC-by-name and events is on the
[roadmap](ROADMAP.md) — without resorting to per-framework catchers.

## Size limits

| Limit | Value | What happens |
|---|---|---|
| Files per repo/workspace | **50,000** | Beyond this the snapshot truncates and reports it — never a silent under-count. |
| Per-file size | **1 MiB** | Larger files are skipped (lockfiles, generated blobs); real modules still read. |
| Comfort zone | **~5,000 files** | Below this, fast. Above it you get an honest heads-up that the first baseline and per-session analysis take longer. Verified clean into the low tens of thousands of files. |

Today Mappamind re-reads the tree each session; on very large repositories that costs a
few minutes. Incremental capture (re-reading only what changed) is on the
[roadmap](ROADMAP.md).

## Requirements

- **Node 20+**
- A model CLI on your `PATH` — `claude` or `codex` (no API key)
- **macOS or Linux** (Windows via WSL — the hooks use POSIX shell)
