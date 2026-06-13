import assert from "node:assert/strict";
import test from "node:test";

import type { Baseline, Capability } from "@mappamind_/baseline";

import { scoreBaseline } from "./score.js";
import { validateGroundTruth } from "./groundTruth.js";
import type { GroundTruth } from "./groundTruth.js";

function cap(name: string, files: string[]): Capability {
  return {
    id: `cap_${name.toLowerCase().replace(/\s+/g, "_")}`,
    name,
    summary: "",
    members: files.map((file) => {
      const slash = file.indexOf("/");
      return { repo: file.slice(0, slash), file: file.slice(slash + 1) };
    }),
    provenance: "derived",
    confidence: "high"
  };
}

function baselineOf(...caps: Capability[]): Baseline {
  return { schemaVersion: 1, workspaceId: "ws", derivedFrom: { factsHash: "h" }, capabilities: caps, edges: [], unknowns: [] };
}

const groundTruth: GroundTruth = {
  label: "synthetic",
  capabilities: [
    { name: "Checkout", files: ["app/src/checkout.ts", "app/src/cart.ts"] },
    { name: "Payments", files: ["app/src/payments.ts"] },
    { name: "Notifications", files: ["app/src/notify.ts"] }
  ]
};

test("perfect baseline scores 100% precision and recall", () => {
  const baseline = baselineOf(
    cap("Checkout", ["app/src/checkout.ts", "app/src/cart.ts"]),
    cap("Billing", ["app/src/payments.ts"]), // different NAME, same files -> still matches Payments
    cap("Notifications", ["app/src/notify.ts"])
  );
  const report = scoreBaseline(baseline, groundTruth);
  assert.equal(report.precision, 1);
  assert.equal(report.recall, 1);
  assert.equal(report.pass.overall, true);
  // Matching is by files, not name: "Billing" matched "Payments".
  const billing = report.matches.find((match) => match.produced === "Billing");
  assert.equal(billing?.expected, "Payments");
});

test("a hallucinated capability tanks precision", () => {
  const baseline = baselineOf(
    cap("Checkout", ["app/src/checkout.ts"]),
    cap("Payments", ["app/src/payments.ts"]),
    cap("Notifications", ["app/src/notify.ts"]),
    cap("Telepathy Engine", ["app/src/telepathy.ts"]) // off-topic file, no GT match
  );
  const report = scoreBaseline(baseline, groundTruth);
  assert.equal(report.matchedCount, 3);
  assert.equal(report.precision, 3 / 4); // 0.75 -> below 0.9 gate
  assert.equal(report.pass.precision, false);
  assert.deepEqual(report.falsePositives, ["Telepathy Engine"]);
});

test("a missed capability lowers recall", () => {
  const baseline = baselineOf(cap("Checkout", ["app/src/checkout.ts", "app/src/cart.ts"]), cap("Payments", ["app/src/payments.ts"]));
  const report = scoreBaseline(baseline, groundTruth);
  assert.equal(report.recall, 2 / 3);
  assert.deepEqual(report.missed, ["Notifications"]);
});

test("citation precision flags off-topic cited files", () => {
  const baseline = baselineOf(
    cap("Checkout", ["app/src/checkout.ts", "app/src/random_unrelated.ts"]) // one in-scope, one not
  );
  const report = scoreBaseline(baseline, groundTruth);
  assert.equal(report.citationPrecision, 1 / 2);
  assert.equal(report.pass.citation, false);
});

test("greedy matching does not let one produced capability claim two expected", () => {
  // A grab-bag capability overlapping both Checkout and Payments matches only ONE.
  const baseline = baselineOf(cap("Everything", ["app/src/checkout.ts", "app/src/cart.ts", "app/src/payments.ts"]));
  const report = scoreBaseline(baseline, groundTruth);
  assert.equal(report.matchedCount, 1);
  assert.equal(report.matches[0]!.expected, "Checkout"); // strongest overlap (2 files) wins
});

test("validateGroundTruth rejects malformed fixtures", () => {
  assert.throws(() => validateGroundTruth({ label: "x" }), /capabilities/);
  assert.throws(() => validateGroundTruth({ label: "x", capabilities: [{ name: "y" }] }), /files/);
  assert.throws(() => validateGroundTruth({ capabilities: [] }), /label/);
});
