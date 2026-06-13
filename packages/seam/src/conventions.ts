// Seam conventions — declarative DATA, not code.
//
// A convention teaches the engine to recognize one technology's seam shape. It is
// pure configuration: which calls are references, which key argument carries the
// name, and where the providing definitions come from. The engine treats every
// convention the same way. Adding a technology (gRPC, REST routes, a queue, a
// homegrown RPC) is a new entry here, never a new code path.
//
// Crucially, conventions are OPTIONAL refinement. The backbone (cross-repo key
// co-occurrence) finds seams with no convention at all; conventions raise
// confidence, attach a label, and let us call an unresolved reference "dangling"
// (which we can only assert when we know the reference was meant to resolve).

export type SeamConvention = {
  readonly id: string;
  // A reference: a call whose callee's last segment is one of `callees`; the key
  // is the `keyArg`-th string argument. `mustResolve` means an unmatched reference
  // is a real dangling edge (we know it was supposed to connect).
  readonly reference?: {
    readonly callees: readonly string[];
    readonly keyArg: number;
    readonly mustResolve: boolean;
  };
  // A provider surface: exported names on the same line as a call to one of
  // `callees` (the "definition marker"). E.g. `exports.validateOutfit =
  // onCall(...)` provides the callable `validateOutfit` without treating helper
  // exports elsewhere in the file as endpoints.
  readonly providerFromExportsOf?: {
    readonly callees: readonly string[];
  };
};

// EMPTY by design (plan Phase 5, C2). The seeded Firebase `httpsCallable`/`onCall`
// convention was a framework catcher — recognition of which strings are channels is
// the model's job now, not a hardcoded technology shape (§I1). The convention
// MECHANISM stays (a project may still supply its own), but ships with no entries:
// the backbone (cross-repo key co-occurrence) plus model adjudication cover the job.
export const DEFAULT_CONVENTIONS: readonly SeamConvention[] = [];
