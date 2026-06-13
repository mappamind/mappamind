import assert from "node:assert/strict";
import test from "node:test";

import { scoreChannels, claimSetChurn, type ProducedChannelEdge } from "./channelScore.js";
import { validateChannelGroundTruth, type ChannelGroundTruth } from "./channelTruth.js";

const truth: ChannelGroundTruth = {
  label: "synthetic",
  edges: [
    { from: "web", to: "catalog", kind: "http", producerFile: "catalog/api.cs", consumerFile: "web/client.cs" },
    { from: "orders", to: "email", kind: "queue", producerFile: "email/consume.ts", consumerFile: "orders/publish.ts" }
  ]
};

function edge(p: Partial<ProducedChannelEdge>): ProducedChannelEdge {
  return {
    from: "web",
    to: "catalog",
    kind: "http",
    direction: "from-calls-to",
    confidence: "verified",
    producerFile: "catalog/api.cs",
    consumerFile: "web/client.cs",
    ...p
  };
}

test("perfect produced edges score 100% precision/recall, zero poison", () => {
  const produced = [
    edge({}),
    edge({ from: "orders", to: "email", kind: "queue", producerFile: "email/consume.ts", consumerFile: "orders/publish.ts" })
  ];
  const report = scoreChannels(produced, truth);
  assert.equal(report.precision, 1);
  assert.equal(report.recall, 1);
  assert.equal(report.poisonPillRate, 0);
  assert.equal(report.pass.overall, true);
});

test("a verified edge with no truth match is a poison pill", () => {
  const produced = [edge({}), edge({ from: "web", to: "ghost", producerFile: "ghost/x.cs", consumerFile: "web/y.cs" })];
  const report = scoreChannels(produced, truth);
  assert.equal(report.matchedCount, 1);
  assert.equal(report.falseVerified, 1);
  assert.equal(report.poisonPillCount, 1);
  assert.equal(report.poisonPillRate, 1 / 2);
  assert.equal(report.pass.poisonPill, false);
});

test("reversed direction on a verified edge is a poison pill, but existence still matches", () => {
  // Same pair + files, but from/to swapped → real edge, wrong arrow.
  const produced = [edge({ from: "catalog", to: "web" })];
  const report = scoreChannels(produced, truth);
  assert.equal(report.matchedCount, 1); // pair matches (unordered) → exists
  assert.equal(report.wrongDirection, 1);
  assert.equal(report.poisonPillRate, 1); // 1 of 1 verified is wrong-direction
});

test("wrong kind on a verified edge is a poison pill; unknown kind is not", () => {
  assert.equal(scoreChannels([edge({ kind: "queue" })], truth).wrongKind, 1);
  assert.equal(scoreChannels([edge({ kind: "unknown" })], truth).wrongKind, 0);
});

test("poison pills are only counted on verified edges, not probable/possible", () => {
  const produced = [edge({ from: "web", to: "ghost", confidence: "possible", producerFile: "g/x", consumerFile: "w/y" })];
  const report = scoreChannels(produced, truth);
  assert.equal(report.verifiedCount, 0);
  assert.equal(report.poisonPillRate, 0);
});

test("candidate-stage recall measures the surfacer ceiling separately", () => {
  // Only the web|catalog pair was surfaced as a candidate; orders|email was missed.
  const report = scoreChannels([], truth, { candidatePairs: ["catalog|web"] });
  assert.equal(report.candidateRecall, 1 / 2);
  // No candidate set supplied → null, not 0.
  assert.equal(scoreChannels([], truth).candidateRecall, null);
});

test("determinism: identical edge sets churn to zero; a changed edge churns", () => {
  const run = [edge({}), edge({ from: "orders", to: "email", kind: "queue", producerFile: "email/consume.ts", consumerFile: "orders/publish.ts" })];
  assert.equal(claimSetChurn(run, [...run]).churn, 0);
  // Reordering must not churn (set-based, position-independent).
  assert.equal(claimSetChurn(run, [run[1]!, run[0]!]).churn, 0);
  // Dropping one edge → churn 1.
  assert.equal(claimSetChurn(run, [run[0]!]).churn, 1);
});

test("validateChannelGroundTruth rejects malformed fixtures", () => {
  assert.throws(() => validateChannelGroundTruth({ label: "x" }), /edges/);
  assert.throws(() => validateChannelGroundTruth({ edges: [] }), /label/);
  assert.throws(() => validateChannelGroundTruth({ label: "x", edges: [{ from: "a" }] }), /to/);
});
