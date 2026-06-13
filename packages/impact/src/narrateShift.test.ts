import assert from "node:assert/strict";
import test from "node:test";

import type { ModelClient } from "@mappamind_/synthesis";

import type { MeshDiff } from "./meshDiff.js";
import { auditNarration, narrateShift } from "./narrateShift.js";
import { classifyBrokenContracts, computeSeverity } from "./shiftCard.js";
import type { ImpactSlice } from "./types.js";

function sliceOf(partial: Partial<ImpactSlice>): ImpactSlice {
  return {
    changedPaths: [],
    unknownPaths: [],
    affectedFiles: [],
    affectedCapabilities: [],
    atRiskContracts: [],
    atRiskServiceEdges: [],
    cosmetic: true,
    ...partial
  };
}

function clientReturning(...texts: string[]): ModelClient & { calls: number } {
  const state = {
    calls: 0,
    async complete() {
      const text = texts[Math.min(state.calls, texts.length - 1)] ?? "";
      state.calls += 1;
      return { text };
    }
  };
  return state;
}

const deadClient: ModelClient = {
  complete: () => Promise.reject(new Error("model unavailable"))
};

// The POC-A shape: shipping renamed away; two consumers dangle; edges lost.
const pocADiff: MeshDiff = {
  brokenContracts: [
    { service: "src/checkoutservice", contract: "shipping", file: "src/checkoutservice/main.go", line: 314 },
    { service: "src/frontend", contract: "shipping", file: "src/frontend/rpc.go", line: 88 }
  ],
  lostEdges: [
    { from: "src/checkoutservice", to: "src/shippingservice", contract: "shipping" },
    { from: "src/frontend", to: "src/shippingservice", contract: "shipping" }
  ],
  newEdges: [],
  removedServices: ["src/shippingservice"],
  addedServices: ["src/logisticsservice"]
};

test("cosmetic slice: deterministic card, the model is never called", async () => {
  const client = clientReturning("should never be used");
  const card = await narrateShift({ slice: sliceOf({ changedPaths: ["leaf.ts"] }), client });
  assert.equal(client.calls, 0);
  assert.equal(card.severity, "cosmetic");
  assert.equal(card.narrationSource, "deterministic");
  assert.equal(card.narration, "Nothing downstream was affected.");
});

test("a provable internal break stays internal even if the model says otherwise", async () => {
  const slice = sliceOf({ changedPaths: ["src/shippingservice/main.go"], cosmetic: false });
  const client = clientReturning(
    JSON.stringify({
      title: "Shipping consumers broken",
      narration: "checkoutservice and frontend still call shipping; its provider is gone.",
      danglingJudgments: [
        { service: "src/checkoutservice", contract: "shipping", kind: "external-service", reason: "wrong" },
        { service: "src/frontend", contract: "shipping", kind: "external-service", reason: "wrong" }
      ]
    })
  );
  const card = await narrateShift({ slice, client, diff: pocADiff });
  assert.equal(card.severity, "broad");
  for (const broken of card.brokenContracts) {
    assert.equal(broken.kind, "internal-break"); // the floor proved it; the model cannot downgrade
    assert.equal(broken.kindSource, "deterministic");
  }
});

test("external-SDK adoption: judged external, severity stays local — no false alarm", async () => {
  const diff: MeshDiff = {
    brokenContracts: [
      { service: "src/cartservice", contract: "secretmanager", file: "src/cartservice/store.cs", line: 33 }
    ],
    lostEdges: [],
    newEdges: [],
    removedServices: [],
    addedServices: []
  };
  const slice = sliceOf({ changedPaths: ["src/cartservice/store.cs"], cosmetic: true });
  const client = clientReturning(
    JSON.stringify({
      title: "cartservice adopted an external secrets service",
      narration: "cartservice now calls secretmanager, a managed cloud service outside the workspace.",
      danglingJudgments: [
        { service: "src/cartservice", contract: "secretmanager", kind: "external-service", reason: "GCP SDK" }
      ]
    })
  );
  const card = await narrateShift({ slice, client, diff });
  assert.equal(card.brokenContracts[0]?.kind, "external-service");
  assert.equal(card.brokenContracts[0]?.kindSource, "model");
  assert.equal(card.severity, "local");
});

test("an unjudged new dangling stays unknown and keeps the session broad (cautious)", async () => {
  const diff: MeshDiff = {
    brokenContracts: [{ service: "src/api", contract: "mystery", file: "src/api/main.go", line: 9 }],
    lostEdges: [],
    newEdges: [],
    removedServices: [],
    addedServices: []
  };
  const slice = sliceOf({ changedPaths: ["src/api/main.go"], cosmetic: true });
  const card = await narrateShift({ slice, client: deadClient, diff });
  assert.equal(card.brokenContracts[0]?.kind, "unknown");
  assert.equal(card.severity, "broad");
  assert.equal(card.narrationSource, "deterministic");
});

test("leash: an ungrounded mention is retried, then the clean answer is used", async () => {
  const slice = sliceOf({
    changedPaths: ["src/shippingservice/main.go"],
    cosmetic: false,
    atRiskServiceEdges: [{ consumer: "src/frontend", provider: "src/shippingservice", contract: "shipping" }]
  });
  const client = clientReturning(
    JSON.stringify({ title: "x", narration: "paymentservice is affected by this change.", danglingJudgments: [] }),
    JSON.stringify({ title: "x", narration: "frontend calls the changed shipping provider.", danglingJudgments: [] })
  );
  const card = await narrateShift({ slice, client });
  assert.equal(client.calls, 2);
  assert.equal(card.narrationSource, "model");
  assert.equal(card.narration, "frontend calls the changed shipping provider.");
});

test("leash: persistent violations fall back to the deterministic narration", async () => {
  const slice = sliceOf({
    changedPaths: ["src/shippingservice/main.go"],
    cosmetic: false,
    atRiskServiceEdges: [{ consumer: "src/frontend", provider: "src/shippingservice", contract: "shipping" }]
  });
  const bad = JSON.stringify({ title: "x", narration: "paymentservice broke.", danglingJudgments: [] });
  const card = await narrateShift({ slice, client: clientReturning(bad, bad) });
  assert.equal(card.narrationSource, "deterministic");
  assert.ok(card.narration.includes("src/frontend"));
});

test("a dead client still yields a complete, grounded card", async () => {
  const slice = sliceOf({
    changedPaths: ["src/shippingservice/main.go"],
    cosmetic: false,
    affectedFiles: [{ path: "src/a.go", depth: 1 }]
  });
  const card = await narrateShift({ slice, client: deadClient, diff: pocADiff, baselineStale: true });
  assert.equal(card.narrationSource, "deterministic");
  assert.equal(card.severity, "broad");
  assert.equal(card.baselineStale, true);
  assert.ok(card.narration.includes("src/checkoutservice/main.go:314"));
});

test("impactedCapabilities and changedSummary come from the floor, not the model", async () => {
  const slice = sliceOf({
    changedPaths: ["util.ts"],
    cosmetic: false,
    affectedFiles: [{ path: "a.ts", depth: 1 }],
    affectedCapabilities: [
      { id: "c1", name: "Checkout", viaFiles: ["a.ts"] },
      { id: "c2", name: "Cart", viaFiles: ["a.ts"] }
    ]
  });
  const client = clientReturning(
    JSON.stringify({ title: "ok", narration: "a.ts depends on the changed util.ts.", danglingJudgments: [] })
  );
  const card = await narrateShift({ slice, client, changedSummary: "edited util.ts (1 file)" });
  assert.deepEqual(card.impactedCapabilities, ["Checkout", "Cart"]);
  assert.equal(card.changedSummary, "edited util.ts (1 file)");
  assert.equal(card.severity, "broad"); // two capabilities touched
});

test("classifyBrokenContracts + computeSeverity: deterministic units", () => {
  const classified = classifyBrokenContracts(pocADiff);
  assert.equal(classified.length, 2);
  assert.ok(classified.every((contract) => contract.kind === "internal-break"));

  const cosmetic = computeSeverity(sliceOf({}), [], undefined);
  assert.equal(cosmetic, "cosmetic");
  const broad = computeSeverity(sliceOf({ cosmetic: false }), classified, pocADiff);
  assert.equal(broad, "broad");
});

test("auditNarration flags unknown paths and services, accepts known ones", () => {
  const allowed = {
    paths: new Set(["src/frontend/rpc.go"]),
    serviceKeys: new Set(["frontend", "shipping"])
  };
  assert.deepEqual(auditNarration("frontend calls shipping via src/frontend/rpc.go:88.", allowed), []);
  const flagged = auditNarration("paymentservice reads src/secret/config.ts now.", allowed);
  assert.ok(flagged.includes("paymentservice"));
  assert.ok(flagged.includes("src/secret/config.ts"));
});

test("auditNarration accepts a directory that contains slice files", () => {
  const allowed = {
    paths: new Set(["src/checkoutservice/main.go"]),
    serviceKeys: new Set(["checkout"])
  };
  // "src/checkoutservice" is the service directory of a known slice file — grounded.
  assert.deepEqual(auditNarration("src/checkoutservice is left calling a missing provider.", allowed), []);
});
