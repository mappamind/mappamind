import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelCandidate } from "@mappamind_/seam";

import { adjudicateChannels, rankByTranscript } from "./adjudicateChannels.js";
import type { ModelClient, ModelRequest } from "./model.js";

// A stub client that returns a canned response per system prompt (channel vs red-team).
function stub(byKind: { adjudicate?: string; redTeam?: string }): ModelClient {
  return {
    async complete(req: ModelRequest) {
      const isRed = (req.system ?? "").startsWith("You are a skeptic");
      return { text: (isRed ? byKind.redTeam : byKind.adjudicate) ?? "{}" };
    }
  };
}

const candidate: ChannelCandidate = {
  key: "api/catalog/items/by",
  ubiquity: 2,
  source: "string-match",
  endpoints: [
    { service: "catalog", file: "catalog/api.cs", line: 31, text: "/api/catalog/items/by" },
    { service: "web", file: "web/client.cs", line: 26, text: "/api/catalog/items/by" }
  ]
};

test("maps a real channel: roles, kind, anchors come from the candidate, not the model", async () => {
  const client = stub({
    adjudicate: JSON.stringify({
      channels: [
        {
          id: "c0_0",
          isChannel: true,
          kind: "http",
          rationale: "catalog serves it; web calls it",
          memberships: [
            { endpoint: 0, role: "produce", confidence: "probable" },
            { endpoint: 1, role: "consume", confidence: "probable" }
          ]
        }
      ]
    })
  });
  const { channels } = await adjudicateChannels({ candidates: [candidate], client });
  assert.equal(channels.length, 1);
  const ch = channels[0]!;
  assert.equal(ch.kind, "http");
  assert.equal(ch.memberships.length, 2);
  const producer = ch.memberships.find((m) => m.role === "produce")!;
  // The anchor is the REAL one from the candidate (model only chose the index).
  assert.equal(producer.anchor.file, "catalog/api.cs");
  assert.equal(producer.anchor.line, 31);
});

test("refuses an invented endpoint index and clamps model 'verified' to 'probable'", async () => {
  const client = stub({
    adjudicate: JSON.stringify({
      channels: [
        {
          id: "c0_0",
          isChannel: true,
          kind: "http",
          rationale: "x",
          memberships: [
            { endpoint: 0, role: "produce", confidence: "verified" }, // model can't self-verify
            { endpoint: 9, role: "consume", confidence: "probable" } // index 9 doesn't exist
          ]
        }
      ]
    })
  });
  const { channels } = await adjudicateChannels({ candidates: [candidate], client });
  // Only one valid membership remains → fewer than 2 services → channel dropped.
  assert.equal(channels.length, 0);
});

test("drops a candidate the model rejects (isChannel:false)", async () => {
  const client = stub({ adjudicate: JSON.stringify({ channels: [{ id: "c0_0", isChannel: false }] }) });
  const { channels } = await adjudicateChannels({ candidates: [candidate], client });
  assert.equal(channels.length, 0);
});

test("a single-service set of memberships is not a channel", async () => {
  const client = stub({
    adjudicate: JSON.stringify({
      channels: [
        {
          id: "c0_0",
          isChannel: true,
          kind: "http",
          rationale: "x",
          memberships: [
            { endpoint: 0, role: "produce", confidence: "probable" },
            { endpoint: 0, role: "consume", confidence: "probable" } // same service twice
          ]
        }
      ]
    })
  });
  const { channels } = await adjudicateChannels({ candidates: [candidate], client });
  assert.equal(channels.length, 0);
});

test("red-team demote lowers confidence; drop removes the channel", async () => {
  const adjudicate = JSON.stringify({
    channels: [
      {
        id: "c0_0",
        isChannel: true,
        kind: "http",
        rationale: "x",
        memberships: [
          { endpoint: 0, role: "produce", confidence: "probable" },
          { endpoint: 1, role: "consume", confidence: "probable" }
        ]
      }
    ]
  });
  const demote = await adjudicateChannels({
    candidates: [candidate],
    client: stub({ adjudicate, redTeam: JSON.stringify({ verdicts: [{ id: "r0", verdict: "demote", reason: "weak" }] }) }),
    redTeam: true
  });
  assert.equal(demote.channels.length, 1);
  assert.ok(demote.channels[0]!.memberships.every((m) => m.confidence === "possible"));

  const dropped = await adjudicateChannels({
    candidates: [candidate],
    client: stub({ adjudicate, redTeam: JSON.stringify({ verdicts: [{ id: "r0", verdict: "drop", reason: "fake" }] }) }),
    redTeam: true
  });
  assert.equal(dropped.channels.length, 0);
});

test("an unparseable batch yields nothing, never a crash", async () => {
  const { channels } = await adjudicateChannels({ candidates: [candidate], client: stub({ adjudicate: "not json at all" }) });
  assert.equal(channels.length, 0);
});

test("rankByTranscript puts candidates the agent mentioned first (recall backstop)", () => {
  const a: ChannelCandidate = { key: "api/a", ubiquity: 2, source: "string-match", endpoints: [{ service: "s1", file: "s1/f", line: 1, text: "/api/a" }, { service: "s2", file: "s2/f", line: 1, text: "/api/a" }] };
  const b: ChannelCandidate = { key: "api/b", ubiquity: 2, source: "string-match", endpoints: [{ service: "s1", file: "s1/f", line: 2, text: "/api/b" }, { service: "s2", file: "s2/f", line: 2, text: "/api/b" }] };
  const ranked = rankByTranscript([a, b], "I renamed the route to /api/b in the handler");
  assert.equal(ranked[0]!.key, "api/b"); // the mentioned one floats up
});

test("a transcript hint reaches the prompt but never bypasses verification", async () => {
  let seenPrompt = "";
  const client: ModelClient = {
    async complete(req: ModelRequest) {
      seenPrompt = req.prompt;
      return {
        text: JSON.stringify({
          channels: [
            { id: "c0_0", isChannel: true, kind: "http", rationale: "x", memberships: [
              { endpoint: 0, role: "produce", confidence: "probable" },
              { endpoint: 1, role: "consume", confidence: "probable" }
            ] }
          ]
        })
      };
    }
  };
  const { channels } = await adjudicateChannels({ candidates: [candidate], client, transcript: "the agent added /api/catalog/items/by" });
  assert.ok(seenPrompt.includes("AGENT SESSION HINT"), "hint block is in the prompt");
  assert.ok(seenPrompt.includes("UNTRUSTED"), "hint is labelled untrusted");
  // The claim is still a proposal — anchors come from the candidate, not the transcript.
  assert.equal(channels.length, 1);
  assert.equal(channels[0]!.memberships[0]!.anchor.file, "catalog/api.cs");
});
