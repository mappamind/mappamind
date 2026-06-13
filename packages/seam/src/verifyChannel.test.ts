import assert from "node:assert/strict";
import test from "node:test";

import type { AnchorFact, FileFacts } from "@mappamind_/extractors";

import type { Channel } from "./channel.js";
import {
  candidateAnchorHash,
  channelEdgeViews,
  channelId,
  partitionByCache,
  verifyChannels
} from "./verifyChannel.js";

// Runtime files (the default) carry one call so they can host a producer; pass
// { declarationOnly: true } for a types-only file (no calls, no executable bodies).
function file(path: string, texts: string[], opts: { declarationOnly?: boolean } = {}): FileFacts {
  const anchors: AnchorFact[] = texts.map((text, i) => ({ text, line: i + 1, role: "call-arg" }));
  const calls = opts.declarationOnly ? [] : [{ callee: "handle", args: [], line: 1 }];
  return { path, language: "typescript", symbols: [], imports: [], calls, exports: [], anchors };
}

function channel(over: Partial<Channel> = {}): Channel {
  return {
    key: "api/items/by",
    kind: "http",
    rationale: "catalog serves; web calls",
    memberships: [
      { service: "catalog", role: "produce", confidence: "probable", anchor: { service: "catalog", file: "catalog/api.cs", line: 31, text: "/api/items/by" } },
      { service: "web", role: "consume", confidence: "probable", anchor: { service: "web", file: "web/client.cs", line: 26, text: "/api/items/by" } }
    ],
    ...over
  };
}

test("verifier admits a channel whose anchors re-find, promoting them to verified", () => {
  const facts = [file("catalog/api.cs", ["/api/items/by"]), file("web/client.cs", ["/api/items/by"])];
  const out = verifyChannels([channel()], facts);
  assert.equal(out.length, 1);
  assert.ok(out[0]!.memberships.every((m) => m.confidence === "verified"));
});

test("a hallucinated anchor is dropped; if it leaves <2 services, the channel dies", () => {
  // web's cited text is NOT present in web/client.cs → that membership drops → only
  // catalog remains → no cross-service edge → channel omitted (silent, not false).
  const facts = [file("catalog/api.cs", ["/api/items/by"]), file("web/client.cs", ["/something/else"])];
  const out = verifyChannels([channel()], facts);
  assert.equal(out.length, 0);
});

test("role gate: a producer in a declaration-only file is dropped → no false edge", () => {
  // catalog's route lives in a types-only declaration file (no calls, no bodies): it
  // can name the route but can't serve it → not a valid producer → only web remains →
  // <2 services → channel omitted. This is the shared-types over-production collapse.
  const facts = [
    file("catalog/types.d.ts", ["/api/items/by"], { declarationOnly: true }),
    file("web/client.cs", ["/api/items/by"])
  ];
  assert.equal(verifyChannels([channel()], facts).length, 0);
});

test("role gate spares consumers: a declaration-only file may still consume", () => {
  // Same channel, roles swapped: the declaration-only file is the CONSUMER. The gate
  // targets producers only, so the channel survives (catalog produces with runtime).
  const swapped = channel({
    memberships: [
      { service: "catalog", role: "consume", confidence: "probable", anchor: { service: "catalog", file: "catalog/types.d.ts", line: 1, text: "/api/items/by" } },
      { service: "web", role: "produce", confidence: "probable", anchor: { service: "web", file: "web/api.cs", line: 1, text: "/api/items/by" } }
    ]
  });
  const facts = [
    file("catalog/types.d.ts", ["/api/items/by"], { declarationOnly: true }),
    file("web/api.cs", ["/api/items/by"])
  ];
  assert.equal(verifyChannels([swapped], facts).length, 1);
});

test("role gate exempts a service IDL: a producer anchored in a .proto survives", () => {
  // A .proto `service{rpc}` declaration authoritatively asserts a SERVED endpoint —
  // unlike a bare type/DTO declaration, it is producer evidence. So a produce membership
  // anchored in a runtime-less contract file survives (the gRPC recovery), whereas the
  // .d.ts case above still drops. The distinction is the contract category, not runtime.
  const grpc = channel({
    key: "basket/getbasket",
    kind: "rpc",
    memberships: [
      { service: "basket", role: "produce", confidence: "probable", anchor: { service: "basket", file: "src/basket/Protos/basket.proto", line: 8, text: "Basket/GetBasket" } },
      { service: "client", role: "consume", confidence: "probable", anchor: { service: "client", file: "src/client/Protos/basket.proto", line: 8, text: "Basket/GetBasket" } }
    ]
  });
  const facts = [
    file("src/basket/Protos/basket.proto", ["Basket/GetBasket"], { declarationOnly: true }),
    file("src/client/Protos/basket.proto", ["Basket/GetBasket"], { declarationOnly: true })
  ];
  const out = verifyChannels([grpc], facts);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.memberships.find((m) => m.service === "basket")!.role, "produce");
});

test("the verifier confirms existence, not relation: direction/kind are untouched", () => {
  const facts = [file("catalog/api.cs", ["/api/items/by"]), file("web/client.cs", ["/api/items/by"])];
  const out = verifyChannels([channel({ kind: "rpc" })], facts);
  assert.equal(out[0]!.kind, "rpc"); // verifier does not second-guess model's kind
});

test("determinism: identical facts → identical channel ids → zero churn", () => {
  const facts = [file("catalog/api.cs", ["/api/items/by"]), file("web/client.cs", ["/api/items/by"])];
  const runA = verifyChannels([channel()], facts).map(channelId);
  const runB = verifyChannels([channel()], facts.slice().reverse()).map(channelId);
  assert.deepEqual(runA, runB);
});

test("cache: a candidate with unchanged evidence is a hit (reused, no model call)", () => {
  const cached = channel();
  const cache = new Map([[candidateAnchorHash({ key: cached.key, ubiquity: 2, source: "string-match", endpoints: cached.memberships.map((m) => m.anchor) }), cached]]);
  const candidate = { key: cached.key, ubiquity: 2, source: "string-match" as const, endpoints: cached.memberships.map((m) => m.anchor) };
  const { hits, misses } = partitionByCache([candidate], cache);
  assert.equal(hits.length, 1);
  assert.equal(misses.length, 0);
  // A changed endpoint text → cache miss → must re-adjudicate.
  const changed = { ...candidate, endpoints: [{ ...candidate.endpoints[0]!, text: "/api/items/by-ids" }, candidate.endpoints[1]!] };
  assert.equal(partitionByCache([changed], cache).misses.length, 1);
});

test("channelEdgeViews derives consumer→producer pairs, one channel never a mesh", () => {
  // 1 producer (catalog), 2 consumers (web, hybrid) → 2 edges, both pointing at catalog.
  const hub = channel({
    memberships: [
      { service: "catalog", role: "produce", confidence: "verified", anchor: { service: "catalog", file: "c/api.cs", line: 1, text: "/x/y" } },
      { service: "web", role: "consume", confidence: "verified", anchor: { service: "web", file: "w/c.cs", line: 1, text: "/x/y" } },
      { service: "hybrid", role: "consume", confidence: "verified", anchor: { service: "hybrid", file: "h/c.cs", line: 1, text: "/x/y" } }
    ]
  });
  const views = channelEdgeViews(hub);
  assert.equal(views.length, 2);
  assert.ok(views.every((v) => v.to === "catalog"));
  assert.deepEqual(views.map((v) => v.from).sort(), ["hybrid", "web"]);
});
