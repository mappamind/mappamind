import assert from "node:assert/strict";
import test from "node:test";

import type { ServiceGraph } from "@mappamind_/seam";

import { diffServiceGraphs } from "./meshDiff.js";

const intact: ServiceGraph = {
  services: ["src/checkout", "src/frontend", "src/shipping"],
  edges: [
    { from: "src/checkout", to: "src/shipping", contract: "shipping" },
    { from: "src/frontend", to: "src/shipping", contract: "shipping" }
  ],
  dangling: []
};

test("the POC-A break: a renamed provider becomes new danglings + lost edges", () => {
  const after: ServiceGraph = {
    services: ["src/checkout", "src/frontend", "src/logistics"],
    edges: [],
    dangling: [
      { service: "src/checkout", contract: "shipping", file: "src/checkout/main.go", line: 314 },
      { service: "src/frontend", contract: "shipping", file: "src/frontend/rpc.go", line: 88 }
    ]
  };
  const diff = diffServiceGraphs(intact, after);

  assert.equal(diff.brokenContracts.length, 2);
  assert.deepEqual(
    diff.brokenContracts.map((d) => d.service).sort(),
    ["src/checkout", "src/frontend"]
  );
  assert.equal(diff.lostEdges.length, 2);
  assert.deepEqual(diff.removedServices, ["src/shipping"]);
  assert.deepEqual(diff.addedServices, ["src/logistics"]);
});

test("identical graphs diff to nothing", () => {
  const diff = diffServiceGraphs(intact, intact);
  assert.deepEqual(diff.brokenContracts, []);
  assert.deepEqual(diff.lostEdges, []);
  assert.deepEqual(diff.newEdges, []);
  assert.deepEqual(diff.removedServices, []);
  assert.deepEqual(diff.addedServices, []);
});

test("a pre-existing dangling (external SDK) is baseline state, not session damage", () => {
  // POC-D: cartservice -> secretmanager dangles in BOTH before and after; the
  // session did not break it, so it must not appear as a broken contract.
  const preExisting = {
    service: "src/cartservice",
    contract: "secretmanager",
    file: "src/cartservice/store.cs",
    line: 33
  };
  const before: ServiceGraph = { ...intact, dangling: [preExisting] };
  const after: ServiceGraph = {
    services: intact.services,
    edges: intact.edges,
    dangling: [
      preExisting,
      { service: "src/frontend", contract: "currency", file: "src/frontend/rpc.go", line: 31 }
    ]
  };
  const diff = diffServiceGraphs(before, after);
  assert.equal(diff.brokenContracts.length, 1);
  assert.equal(diff.brokenContracts[0]?.contract, "currency");
});
