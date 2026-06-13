import assert from "node:assert/strict";
import test from "node:test";

import type { Channel } from "@mappamind_/seam";

import { channelsToScoredEdges } from "./channelEdges.js";
import { scoreChannels } from "./channelScore.js";

const verifiedChannel: Channel = {
  key: "api/items",
  kind: "http",
  rationale: "",
  memberships: [
    { service: "catalog", role: "produce", confidence: "verified", anchor: { service: "catalog", file: "catalog/api.cs", line: 31, text: "/api/items" } },
    { service: "web", role: "consume", confidence: "verified", anchor: { service: "web", file: "web/client.cs", line: 26, text: "/api/items" } }
  ]
};

test("derives a directed consumer→producer edge with cited files and verified confidence", () => {
  const [edge, ...rest] = channelsToScoredEdges([verifiedChannel]);
  assert.equal(rest.length, 0);
  assert.deepEqual(
    { from: edge!.from, to: edge!.to, kind: edge!.kind, confidence: edge!.confidence, producerFile: edge!.producerFile, consumerFile: edge!.consumerFile },
    { from: "web", to: "catalog", kind: "http", confidence: "verified", producerFile: "catalog/api.cs", consumerFile: "web/client.cs" }
  );
});

test("a hub fans into one edge per consumer; the result scores cleanly against truth", () => {
  const hub: Channel = {
    key: "api/items",
    kind: "http",
    rationale: "",
    memberships: [
      verifiedChannel.memberships[0]!,
      verifiedChannel.memberships[1]!,
      { service: "hybrid", role: "consume", confidence: "verified", anchor: { service: "hybrid", file: "hybrid/c.cs", line: 9, text: "/api/items" } }
    ]
  };
  const edges = channelsToScoredEdges([hub]);
  assert.equal(edges.length, 2);
  const report = scoreChannels(edges, {
    label: "t",
    edges: [
      { from: "web", to: "catalog", kind: "http", producerFile: "catalog/api.cs", consumerFile: "web/client.cs" },
      { from: "hybrid", to: "catalog", kind: "http", producerFile: "catalog/api.cs", consumerFile: "hybrid/c.cs" }
    ]
  });
  assert.equal(report.precision, 1);
  assert.equal(report.recall, 1);
  assert.equal(report.poisonPillRate, 0);
});

test("an unverified membership yields a non-verified edge (kept out of poison metric)", () => {
  const probable: Channel = {
    ...verifiedChannel,
    memberships: [verifiedChannel.memberships[0]!, { ...verifiedChannel.memberships[1]!, confidence: "possible" }]
  };
  assert.equal(channelsToScoredEdges([probable])[0]!.confidence, "possible");
});
