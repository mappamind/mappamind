import assert from "node:assert/strict";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";

import { buildWorkspaceModel } from "./build.js";
import { groundBaseline } from "./grounding.js";
import type { ProposedBaseline } from "./capabilities.js";
import type { RepoFiles } from "./model.js";

function file(partial: Partial<FileFacts> & { path: string; language: string }): FileFacts {
  return { symbols: [], imports: [], calls: [], exports: [], anchors: [], ...partial };
}

// A small but real workspace: checkout depends on payments (a relative import).
const repos: RepoFiles[] = [
  {
    repo: "app",
    files: [
      file({
        path: "src/checkout.ts",
        language: "typescript",
        symbols: [{ kind: "function", name: "checkout", line: 10 }],
        imports: [{ module: "./payments", line: 1 }]
      }),
      file({
        path: "src/payments.ts",
        language: "typescript",
        symbols: [{ kind: "function", name: "charge", line: 5 }],
        exports: [{ name: "charge", line: 5 }]
      })
    ]
  }
];

const model = buildWorkspaceModel(repos);

test("admits a grounded capability and fills the line from facts", () => {
  const proposed: ProposedBaseline = {
    capabilities: [
      { name: "Checkout", summary: "places an order", members: [{ repo: "app", file: "src/checkout.ts", symbol: "checkout" }] }
    ],
    edges: [],
    unknowns: []
  };
  const { baseline, droppedCapabilities } = groundBaseline(proposed, repos, model, "ws1", "h1");
  assert.equal(droppedCapabilities.length, 0);
  assert.equal(baseline.capabilities.length, 1);
  const cap = baseline.capabilities[0]!;
  assert.equal(cap.id, "cap_checkout");
  assert.equal(cap.confidence, "high"); // symbol-level citation
  assert.equal(cap.members[0]!.line, 10); // filled in from facts
});

test("DROPS a hallucinated capability — the v1 failure mode, structurally gone", () => {
  const proposed: ProposedBaseline = {
    capabilities: [
      // Cites a file that does not exist.
      { name: "Ghost", summary: "imagined", members: [{ repo: "app", file: "src/does_not_exist.ts" }] },
      // Cites a real file but a symbol that is not in it.
      { name: "Phantom", summary: "imagined", members: [{ repo: "app", file: "src/checkout.ts", symbol: "notARealFn" }] }
    ],
    edges: [],
    unknowns: []
  };
  const { baseline, droppedCapabilities } = groundBaseline(proposed, repos, model, "ws1", "h1");
  assert.equal(baseline.capabilities.length, 0);
  assert.equal(droppedCapabilities.length, 2);
  assert.ok(droppedCapabilities.every((dropped) => dropped.reason === "no-grounded-members"));
});

test("keeps only the grounded members of a partially-hallucinated capability", () => {
  const proposed: ProposedBaseline = {
    capabilities: [
      {
        name: "Payments",
        summary: "charges cards",
        members: [
          { repo: "app", file: "src/payments.ts", symbol: "charge" }, // real
          { repo: "app", file: "src/imaginary.ts", symbol: "wat" } // hallucinated
        ]
      }
    ],
    edges: [],
    unknowns: []
  };
  const { baseline } = groundBaseline(proposed, repos, model, "ws1", "h1");
  assert.equal(baseline.capabilities.length, 1);
  assert.equal(baseline.capabilities[0]!.members.length, 1);
  assert.equal(baseline.capabilities[0]!.members[0]!.file, "src/payments.ts");
});

test("admits an edge only when a real dependency backs it; drops invented edges", () => {
  const proposed: ProposedBaseline = {
    capabilities: [
      { name: "Checkout", summary: "", members: [{ repo: "app", file: "src/checkout.ts", symbol: "checkout" }] },
      { name: "Payments", summary: "", members: [{ repo: "app", file: "src/payments.ts", symbol: "charge" }] }
    ],
    // Checkout -> Payments is real (checkout.ts imports payments.ts).
    // Payments -> Checkout is invented (no such import).
    edges: [
      { from: "Checkout", to: "Payments" },
      { from: "Payments", to: "Checkout" }
    ],
    unknowns: []
  };
  const { baseline, droppedEdges } = groundBaseline(proposed, repos, model, "ws1", "h1");
  assert.equal(baseline.edges.length, 1);
  assert.equal(baseline.edges[0]!.from, "cap_checkout");
  assert.equal(baseline.edges[0]!.to, "cap_payments");
  assert.equal(baseline.edges[0]!.via, "dependency");
  assert.equal(droppedEdges.length, 1);
  assert.equal(droppedEdges[0]!.reason, "no-backing-edge");
});

test("carries the workspace id and facts hash for staleness detection", () => {
  const { baseline } = groundBaseline({ capabilities: [], edges: [], unknowns: [] }, repos, model, "ws-42", "facts-abc");
  assert.equal(baseline.workspaceId, "ws-42");
  assert.equal(baseline.derivedFrom.factsHash, "facts-abc");
  assert.equal(baseline.schemaVersion, 1);
});
