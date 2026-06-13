import assert from "node:assert/strict";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";

import { detectSeams } from "./detect.js";
import type { SeamConvention } from "./conventions.js";
import type { RepoFacts } from "./types.js";

function file(partial: Partial<FileFacts> & { path: string; language: string }): FileFacts {
  return { symbols: [], imports: [], calls: [], exports: [], anchors: [], ...partial };
}

test("backbone finds a cross-repo seam with NO convention at all", () => {
  // A string referenced in one repo that names an export in another repo is a
  // contract, detected with zero technology knowledge.
  const a: RepoFacts = {
    repo: "web",
    files: [file({ path: "client.ts", language: "typescript", calls: [{ callee: "rpc.invoke", args: ["OrderService"], line: 10 }] })]
  };
  const b: RepoFacts = {
    repo: "api",
    files: [file({ path: "order.ts", language: "typescript", exports: [{ name: "OrderService", line: 3 }] })]
  };

  const report = detectSeams([a, b], []); // <-- no conventions
  const contract = report.contracts.find((c) => c.key === "OrderService");
  assert.equal(contract?.status, "in_sync");
  assert.equal(contract?.confidence, "medium"); // backbone-only
  assert.equal(contract?.seamType, undefined);
  assert.equal(contract?.crossesBoundary, true);
});

test("a convention labels seams and flags a dangling reference", () => {
  const client: RepoFacts = {
    repo: "app",
    files: [
      file({ path: "lib/validate.dart", language: "dart", calls: [{ callee: "httpsCallable", args: ["validateOutfit"], line: 94 }] }),
      file({ path: "lib/chat.dart", language: "dart", calls: [{ callee: "httpsCallable", args: ["chatStylist"], line: 30 }] })
    ]
  };
  const backend: RepoFacts = {
    repo: "backend",
    files: [
      file({
        path: "functions/validateOutfit.js",
        language: "javascript",
        calls: [{ callee: "functions.https.onCall", args: [], line: 16 }],
        exports: [
          { name: "REBUILD_SKIP_WINDOW_MS", line: 3 },
          { name: "shouldSkipRebuild", line: 8 },
          { name: "validateOutfit", line: 16 }
        ]
      }),
      file({ path: "functions/admin.js", language: "javascript", calls: [{ callee: "https.onCall", args: [], line: 5 }], exports: [{ name: "adminTool", line: 5 }] })
    ]
  };

  // The convention MECHANISM stays; only the seeded Firebase default was removed
  // (Phase 5, C2). A project supplies its own convention — proven here explicitly.
  const callable: SeamConvention = {
    id: "callable",
    reference: { callees: ["httpsCallable"], keyArg: 0, mustResolve: true },
    providerFromExportsOf: { callees: ["onCall"] }
  };
  const report = detectSeams([client, backend], [callable]);

  const validate = report.contracts.find((c) => c.key === "validateOutfit");
  assert.equal(validate?.status, "in_sync");
  assert.equal(validate?.confidence, "high");
  assert.equal(validate?.seamType, "callable");
  assert.equal(validate?.crossesBoundary, true);

  assert.equal(report.dangling.length, 1);
  assert.equal(report.dangling[0]?.key, "chatStylist");
  assert.equal(report.dangling[0]?.confidence, "high");

  const orphan = report.contracts.find((c) => c.key === "adminTool");
  assert.equal(orphan?.status, "orphan");

  assert.equal(report.contracts.find((c) => c.key === "REBUILD_SKIP_WINDOW_MS"), undefined);
  assert.equal(report.contracts.find((c) => c.key === "shouldSkipRebuild"), undefined);
});

test("prose and within-repo collisions are not treated as seams", () => {
  const repo: RepoFacts = {
    repo: "app",
    files: [
      file({ path: "a.ts", language: "typescript", calls: [{ callee: "log", args: ["user did a thing"], line: 1 }] }),
      // a string arg that matches a symbol in the SAME repo is not a cross-boundary seam
      file({ path: "b.ts", language: "typescript", calls: [{ callee: "emit", args: ["ready"], line: 2 }] }),
      file({ path: "c.ts", language: "typescript", symbols: [{ kind: "function", name: "ready", line: 9 }] })
    ]
  };
  const report = detectSeams([repo], []); // no conventions
  assert.equal(report.contracts.length, 0);
});
