import assert from "node:assert/strict";
import test from "node:test";

import type { Baseline, WorkspaceModel } from "@mappamind_/baseline";
import type { SeamReport, ServiceGraph } from "@mappamind_/seam";

import { computeBlastRadius } from "./blastRadius.js";
import { buildReverseIndex } from "./reverseIndex.js";

type TestEdge = readonly [string, string] | readonly [string, string, "re-export"];

function modelOf(paths: readonly string[], edges: readonly TestEdge[]): WorkspaceModel {
  return {
    repos: ["app"],
    modules: paths.map((path) => ({ repo: "app", path, language: "typescript", symbolCount: 0, exportNames: [] })),
    edges: edges.map(([from, to, edgeKind]) => ({ repo: "app", from, to, ...(edgeKind ? { edgeKind } : {}) })),
    unresolvedImports: 0,
    languages: [{ language: "typescript", files: paths.length }]
  };
}

test("exact reverse set: complete, none invented, depths right", () => {
  // util <- a <- b <- c <- d. Change util: ALL of it is the blast radius —
  // unbounded by default, because a capped walk is a false "safe" (POC-B).
  const model = modelOf(
    ["util.ts", "a.ts", "b.ts", "c.ts", "d.ts"],
    [
      ["a.ts", "util.ts"],
      ["b.ts", "a.ts"],
      ["c.ts", "b.ts"],
      ["d.ts", "c.ts"]
    ]
  );
  const slice = computeBlastRadius({ model, changedPaths: ["util.ts"] });

  assert.deepEqual(slice.changedPaths, ["util.ts"]);
  assert.deepEqual(slice.affectedFiles, [
    { path: "a.ts", depth: 1 },
    { path: "b.ts", depth: 2 },
    { path: "c.ts", depth: 3 },
    { path: "d.ts", depth: 4 }
  ]);
  assert.equal(slice.cosmetic, false);

  // an explicit maxDepth is honored
  const shallow = computeBlastRadius({ model, changedPaths: ["util.ts"], maxDepth: 1 });
  assert.deepEqual(shallow.affectedFiles, [{ path: "a.ts", depth: 1 }]);
});

test("diamond: each dependent appears once, at its nearest depth", () => {
  // util <- a, util <- b, a <- app, b <- app: app reachable two ways, one entry.
  const model = modelOf(
    ["util.ts", "a.ts", "b.ts", "app.ts"],
    [
      ["a.ts", "util.ts"],
      ["b.ts", "util.ts"],
      ["app.ts", "a.ts"],
      ["app.ts", "b.ts"]
    ]
  );
  const slice = computeBlastRadius({ model, changedPaths: ["util.ts"] });
  assert.deepEqual(slice.affectedFiles, [
    { path: "a.ts", depth: 1 },
    { path: "b.ts", depth: 1 },
    { path: "app.ts", depth: 2 }
  ]);
});

test("re-export edges identify barrel carriers separately from affected files", () => {
  const model = modelOf(
    ["util.ts", "index.ts", "app.ts"],
    [
      ["index.ts", "util.ts", "re-export"],
      ["app.ts", "index.ts"]
    ]
  );
  const slice = computeBlastRadius({ model, changedPaths: ["util.ts"] });
  assert.deepEqual(slice.affectedFiles, [
    { path: "index.ts", depth: 1 },
    { path: "app.ts", depth: 2 }
  ]);
  assert.deepEqual(slice.reExportCarriers, ["index.ts"]);
});

test("cosmetic fold: a leaf change with nothing downstream raises no alarm", () => {
  const model = modelOf(["leaf.ts", "main.ts"], [["leaf.ts", "main.ts"]]); // leaf imports main
  const slice = computeBlastRadius({ model, changedPaths: ["leaf.ts"] });
  assert.deepEqual(slice.affectedFiles, []);
  assert.equal(slice.cosmetic, true);
});

test("unknown paths are reported, never seeds; alone they are cosmetic", () => {
  const model = modelOf(["a.ts"], []);
  const slice = computeBlastRadius({ model, changedPaths: ["README.md", "a.ts"] });
  assert.deepEqual(slice.unknownPaths, ["README.md"]);
  assert.deepEqual(slice.changedPaths, ["a.ts"]);
  assert.equal(slice.cosmetic, true);
});

test("contract break: a changed seam definition puts every consumer at risk", () => {
  const model = modelOf(["functions/chat.js", "app/caller.dart"], []);
  const seams: SeamReport = {
    contracts: [
      {
        key: "chatStylist",
        status: "in_sync",
        confidence: "high",
        seamType: "callable",
        crossesBoundary: true,
        references: [
          { key: "chatStylist", side: "reference", kind: "string-arg", repo: "app", file: "app/caller.dart", line: 29 }
        ],
        definitions: [
          { key: "chatStylist", side: "definition", kind: "export", repo: "fns", file: "functions/chat.js", line: 5 }
        ]
      }
    ],
    dangling: []
  };
  const slice = computeBlastRadius({ model, changedPaths: ["functions/chat.js"], seams });
  assert.equal(slice.atRiskContracts.length, 1);
  assert.equal(slice.atRiskContracts[0]?.key, "chatStylist");
  assert.deepEqual(slice.atRiskContracts[0]?.definedIn, ["functions/chat.js"]);
  assert.equal(slice.atRiskContracts[0]?.consumers[0]?.file, "app/caller.dart");
  assert.equal(slice.cosmetic, false);
});

test("the POC-A case: imports see nothing, the mesh still flags the consumers", () => {
  // A change inside the shipping service has ZERO import dependents (gRPC is not
  // an import edge) — file-level alone would call this cosmetic. The mesh must not.
  const model = modelOf(["src/shipping/main.go", "src/frontend/rpc.go"], []);
  const mesh: ServiceGraph = {
    services: ["src/frontend", "src/shipping", "src/checkout"],
    edges: [
      { from: "src/frontend", to: "src/shipping", contract: "shipping" },
      { from: "src/checkout", to: "src/shipping", contract: "shipping" },
      { from: "src/frontend", to: "src/checkout", contract: "checkout" }
    ],
    dangling: []
  };
  const slice = computeBlastRadius({ model, changedPaths: ["src/shipping/main.go"], mesh });
  assert.deepEqual(slice.affectedFiles, []); // imports are blind here
  assert.deepEqual(slice.atRiskServiceEdges, [
    { consumer: "src/checkout", provider: "src/shipping", contract: "shipping" },
    { consumer: "src/frontend", provider: "src/shipping", contract: "shipping" }
  ]);
  assert.equal(slice.cosmetic, false); // seam ∪ file-level: the union decides
});

test("capabilities with members in changed ∪ affected are listed as context", () => {
  const model = modelOf(["util.ts", "checkout.ts"], [["checkout.ts", "util.ts"]]);
  const baseline: Baseline = {
    schemaVersion: 1,
    workspaceId: "ws_x",
    derivedFrom: { factsHash: "h" },
    capabilities: [
      {
        id: "cap-checkout",
        name: "Checkout",
        summary: "places orders",
        members: [{ repo: "app", file: "checkout.ts" }],
        provenance: "derived",
        confidence: "high"
      },
      {
        id: "cap-other",
        name: "Unrelated",
        summary: "elsewhere",
        members: [{ repo: "app", file: "elsewhere.ts" }],
        provenance: "derived",
        confidence: "high"
      }
    ],
    edges: [],
    unknowns: []
  };
  const slice = computeBlastRadius({ model, changedPaths: ["util.ts"], baseline });
  assert.deepEqual(slice.affectedCapabilities, [{ id: "cap-checkout", name: "Checkout", viaFiles: ["checkout.ts"] }]);
});

test("broken-contract consumer files map to capabilities without becoming import dependents", () => {
  const model = modelOf(
    ["src/shipping/main.go", "src/checkout/main.go", "src/frontend/rpc.go"],
    []
  );
  const baseline: Baseline = {
    schemaVersion: 1,
    workspaceId: "ws_x",
    derivedFrom: { factsHash: "h" },
    capabilities: [
      {
        id: "cap-checkout",
        name: "Checkout",
        summary: "places orders",
        members: [{ repo: "app", file: "src/checkout/main.go" }],
        provenance: "derived",
        confidence: "high"
      },
      {
        id: "cap-storefront",
        name: "Storefront",
        summary: "renders the shop",
        members: [{ repo: "app", file: "src/frontend/rpc.go" }],
        provenance: "derived",
        confidence: "high"
      }
    ],
    edges: [],
    unknowns: []
  };
  const slice = computeBlastRadius({
    model,
    changedPaths: ["src/shipping/main.go"],
    baseline,
    brokenContractConsumerFiles: ["src/checkout/main.go", "src/frontend/rpc.go"]
  });

  assert.deepEqual(slice.affectedFiles, []);
  assert.deepEqual(slice.affectedCapabilities, [
    { id: "cap-checkout", name: "Checkout", viaFiles: ["src/checkout/main.go"] },
    { id: "cap-storefront", name: "Storefront", viaFiles: ["src/frontend/rpc.go"] }
  ]);
});

test("reverse index dedupes a doubled import into one dependency", () => {
  const model: WorkspaceModel = {
    repos: ["app"],
    modules: [],
    edges: [
      { repo: "app", from: "a.ts", to: "b.ts" },
      { repo: "app", from: "a.ts", to: "b.ts" }
    ],
    unresolvedImports: 0,
    languages: []
  };
  assert.deepEqual(buildReverseIndex(model).get("b.ts"), ["a.ts"]);
});
