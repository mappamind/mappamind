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
