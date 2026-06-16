import assert from "node:assert/strict";
import test from "node:test";

import type { Channel } from "@mappamind_/seam";

import { diffChannels } from "./channelDiff.js";

function channel(key: string, members: { service: string; role: "produce" | "consume"; text?: string }[]): Channel {
  return {
    key,
    kind: "http",
    rationale: "",
    memberships: members.map((m) => ({
      service: m.service,
      role: m.role,
      confidence: "verified",
      anchor: { service: m.service, file: `${m.service}/f`, line: 1, text: m.text ?? key }
    }))
  };
}

const base = channel("api/items", [
  { service: "catalog", role: "produce" },
  { service: "web", role: "consume" }
]);

test("an added channel is reported as added + verified", () => {
  const changes = diffChannels([], [base]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, "added");
  assert.equal(changes[0]!.verified, true);
});

test("a removed channel is reported as removed + not verified", () => {
  const changes = diffChannels([base], []);
  assert.equal(changes[0]!.change, "removed");
  assert.equal(changes[0]!.verified, false);
});

test("adding a consumer to an existing channel is a single 'changed'", () => {
  const after = channel("api/items", [
    { service: "catalog", role: "produce" },
    { service: "web", role: "consume" },
    { service: "hybrid", role: "consume" }
  ]);
  const changes = diffChannels([base], [after]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, "changed");
  assert.equal(changes[0]!.channel.memberships.length, 3);
});

test("identical channels produce no change (determinism)", () => {
  assert.equal(diffChannels([base], [channel("api/items", [{ service: "catalog", role: "produce" }, { service: "web", role: "consume" }])]).length, 0);
});

test("a channel that loses its producer is 'broken' (not a green added/verified channel)", () => {
  // The provider renamed/removed its route; the consumer still calls the old key.
  const after = channel("api/items", [{ service: "web", role: "consume" }]);
  const changes = diffChannels([base], [after]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, "broken");
  assert.equal(changes[0]!.lostRole, "produce");
  assert.equal(changes[0]!.verified, false);
  assert.equal(changes[0]!.priorChannel?.key, "api/items");
});

test("a channel that loses its consumer is 'broken' (consume)", () => {
  const after = channel("api/items", [{ service: "catalog", role: "produce" }]);
  const changes = diffChannels([base], [after]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, "broken");
  assert.equal(changes[0]!.lostRole, "consume");
});

test("a genuinely new consumer-only channel stays 'added', never falsely 'broken'", () => {
  const after = channel("api/new", [{ service: "web", role: "consume" }]);
  const added = diffChannels([base], [after]).find((c) => c.channel.key === "api/new");
  assert.equal(added?.change, "added");
});

test("a producer dropped from a 3-service channel is 'broken' (identity is the key)", () => {
  // channelId is the normalized key, so a channel that loses its provider keeps its id
  // and is matched as the same channel — the diff must surface the break, not a benign
  // "changed" (the regression eShop's api/orders exposed: a route that lost its provider).
  const before = channel("api/orders", [
    { service: "alpha", role: "consume" },
    { service: "mid", role: "produce" },
    { service: "zulu", role: "consume" }
  ]);
  const after = channel("api/orders", [
    { service: "alpha", role: "consume" },
    { service: "zulu", role: "consume" }
  ]);
  const changes = diffChannels([before], [after]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, "broken");
  assert.equal(changes[0]!.lostRole, "produce");
  assert.equal(changes[0]!.priorChannel?.key, "api/orders");
});

test("a provider swap is a single 'changed', not added+removed", () => {
  // The provider service is renamed (alpha → beta) but the route still has a provider
  // and consumers. Keying identity on the service set would emit removed+added (two
  // contradictory rows for a still-served route); key-identity keeps it one 'changed'.
  const before = channel("api/orders", [
    { service: "alpha", role: "produce" },
    { service: "web", role: "consume" }
  ]);
  const after = channel("api/orders", [
    { service: "beta", role: "produce" },
    { service: "web", role: "consume" }
  ]);
  const changes = diffChannels([before], [after]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0]!.change, "changed");
});
