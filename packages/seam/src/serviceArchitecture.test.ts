import assert from "node:assert/strict";
import test from "node:test";

import type { Channel } from "./channel.js";
import { buildServiceGraph } from "./serviceArchitecture.js";
import type { ServiceBoundaries } from "./serviceBoundary.js";

function boundaries(...services: string[]): ServiceBoundaries {
  return { services: services.sort(), serviceByPath: new Map() };
}

function channel(key: string, members: { service: string; role: "produce" | "consume" }[]): Channel {
  return {
    key,
    kind: "http",
    rationale: "",
    memberships: members.map((m) => ({
      service: m.service,
      role: m.role,
      confidence: "verified",
      anchor: { service: m.service, file: `${m.service}/f`, line: 1, text: key }
    }))
  };
}

test("buildServiceGraph derives consumer→producer edges from verified channels", () => {
  const graph = buildServiceGraph(boundaries("checkout", "cart", "payment"), [
    channel("rpc/cart/get", [
      { service: "cart", role: "produce" },
      { service: "checkout", role: "consume" }
    ]),
    channel("rpc/pay/charge", [
      { service: "payment", role: "produce" },
      { service: "checkout", role: "consume" }
    ])
  ]);
  assert.deepEqual(
    graph.edges.map((e) => `${e.from}->${e.to}`).sort(),
    ["checkout->cart", "checkout->payment"]
  );
  assert.equal(graph.dangling.length, 0);
});

test("a 1-producer/2-consumer hub renders as two edges to one provider, not a mesh", () => {
  const graph = buildServiceGraph(boundaries("catalog", "web", "hybrid"), [
    channel("api/items/by", [
      { service: "catalog", role: "produce" },
      { service: "web", role: "consume" },
      { service: "hybrid", role: "consume" }
    ])
  ]);
  assert.deepEqual(graph.edges.map((e) => `${e.from}->${e.to}`).sort(), ["hybrid->catalog", "web->catalog"]);
  assert.ok(graph.edges.every((e) => e.contract === "api/items/by"));
});

test("edges are deterministically ordered and services come from boundaries", () => {
  const graph = buildServiceGraph(boundaries("z", "a", "b"), []);
  assert.deepEqual(graph.services, ["a", "b", "z"]);
  assert.equal(graph.edges.length, 0);
});
