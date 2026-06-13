# Roadmap

Where Mappamind is going — and, just as important, the rules any change has to respect to
get there. This is a guide for contributors: pick something up, but build it the way the
architecture demands.

Read [ARCHITECTURE.md](ARCHITECTURE.md) first.

## The rules every change must keep

These aren't style preferences; they are the product.

1. **The leash.** Every intelligent output cites a real code fact or it is dropped. The
   model proposes; a citation grounds it; an ungrounded claim never reaches the screen.
2. **No catchers.** New language, framework, or medium coverage is a prompt and a schema —
   never a hardcoded pattern (`if framework === ...`). Recognition belongs to the model;
   the deterministic floor only extracts universal facts and proposes candidates by
   generic, *structural* rules (this is invariant I1 — keep the floor framework-agnostic).
3. **Miss over fabricate.** When unsure, stay quiet. A missed edge is recoverable; a
   confident wrong one breaks the trust the whole product runs on.
4. **Self-contained output.** Rendered cards and the Studio are one HTML file — no
   `<script>`, no external assets, no network. They open offline and travel as a file.

If a change would break one of these, it's the wrong change — find the version that
doesn't.

## Coverage — beyond string-routed meshes

The cross-service detector links services by shared identifiers (a route path, a topic).
The next frontier is the meshes that leave no shared string behind — extended
**generically**, never with per-framework catchers:

- **Name-reference join** *(highest leverage).* Today the join is "the same string in two
  services." Add "a string that **names** another service." A service name referenced in
  one boundary *is* a cross-service reference — one structural change that unlocks the
  whole RPC-by-name family (Feign, gRPC, service-DNS) at once. The floor proposes; the
  model and the producer role gate still adjudicate (a bare name match is noisier than a
  route, so the gate matters more here).
- **Type-reference join** *(for events).* A message/event **type** defined in one boundary
  and referenced in another, in a publish/subscribe shape. Fuzzier — it overlaps shared
  data structures — so it leans harder on the model and the declaration-only gate to tell
  a real event channel from a shared DTO.
- **Conventions as data.** The seam-convention mechanism exists and ships empty. Let teams
  supply their own stack's join as configuration — never as default catchers in core.
- **Runtime / transcript signal.** For calls static analysis can't see, the session
  transcript (already wired) and runtime tracing are the backstop.

## Performance and scale

- **Incremental capture** *(the big win).* Re-parse only the paths that changed instead of
  the whole tree every session. The session snapshot already holds the "before," so
  per-session cost can track the diff, not the repo size.
- **Progressive first baseline.** Make the initial `setup` non-blocking on large repos —
  show exact-match and contract edges instantly, stream the model-adjudicated ones.
- **Capability synthesis at scale.** A very large monorepo becomes one giant inventory
  prompt; chunk or sample it so capabilities don't come back empty.

## Product

- **Boundary detection on monorepos.** Don't carve build/tooling directories into
  "services." Distinguish deployable units from CLI tools and generated code.
- **Verdict / correction loop.** Re-introduce accept/reject/correct only when it is
  *genuinely* wired — corrections consumed by the next pass, and clickable (which needs the
  local server that `serve` mode would provide). Until then, no fake feedback loop on a
  static card.
- **`serve` live mode.** An auto-refreshing local view layered on the same store; also the
  natural home for clickable verdicts.

## Hosts and integrations

- More agent hosts (e.g. Cursor) once there's a real user to co-test the integration seam.
- A documented, host-neutral card-generation contract, so third parties can integrate
  without bespoke glue.

## Contributing

Build setup and the package layout are in the [README](../README.md#develop). A good first
move: start from a held-out repository or a failing test, keep the four rules above —
especially *no catchers in the floor* — and run `npm test`. New medium or language
coverage should add a prompt and a schema, not new parsing or pattern-matching code.
