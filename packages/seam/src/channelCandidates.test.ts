import assert from "node:assert/strict";
import test from "node:test";

import type { AnchorFact, FileFacts } from "@mappamind_/extractors";

import { surfaceChannelCandidates, normKey } from "./channelCandidates.js";

function file(path: string, anchors: AnchorFact[], imports: string[] = []): FileFacts {
  return {
    path,
    language: "typescript",
    symbols: [],
    imports: imports.map((module) => ({ module, line: 1 })),
    calls: [],
    exports: [],
    anchors
  };
}

function anchor(text: string, line: number, role: AnchorFact["role"] = "call-arg"): AnchorFact {
  return { text, line, role };
}

test("a structured route shared across two services surfaces as a candidate with both anchors", () => {
  const files = [
    file("catalog/api.cs", [anchor("/api/catalog/items/by", 31)]),
    file("web/client.cs", [anchor("https://catalog/api/catalog/items/by?ids=1", 26)])
  ];
  const svc = new Map([
    ["catalog/api.cs", "catalog"],
    ["web/client.cs", "web"]
  ]);
  const candidates = surfaceChannelCandidates(files, svc);
  const route = candidates.find((c) => c.key === "api/catalog/items/by");
  assert.ok(route, "expected the shared route to surface");
  assert.equal(route!.ubiquity, 2);
  assert.equal(route!.source, "string-match");
  // Both cited sites are retained as AnchorRefs (needed for proofs downstream).
  const services = new Set(route!.endpoints.map((e) => e.service));
  assert.deepEqual([...services].sort(), ["catalog", "web"]);
  assert.ok(route!.endpoints.some((e) => e.file === "catalog/api.cs" && e.line === 31));
});

test("a hub route consumed by 4 services is NOT dropped (no ubiquity hard filter)", () => {
  const files = [
    file("hub/api.ts", [anchor("/v1/orders/items", 5)]),
    file("a/c.ts", [anchor("/v1/orders/items", 9)]),
    file("b/c.ts", [anchor("/v1/orders/items", 9)]),
    file("c/c.ts", [anchor("/v1/orders/items", 9)]),
    file("d/c.ts", [anchor("/v1/orders/items", 9)])
  ];
  const svc = new Map(files.map((f, i) => [f.path, ["hub", "a", "b", "c", "d"][i]!]));
  const candidates = surfaceChannelCandidates(files, svc);
  const hub = candidates.find((c) => c.key === "v1/orders/items");
  assert.ok(hub, "the 5-service hub must survive — the old UBIQUITY_LIMIT=3 deleted exactly these");
  assert.equal(hub!.ubiquity, 5);
});

test("import specifiers and same-service-only keys are excluded", () => {
  const files = [
    // shared, but it's an import module specifier in both → not a channel
    file("a/x.ts", [anchor("@scope/shared/pkg", 1)], ["@scope/shared/pkg"]),
    file("b/y.ts", [anchor("@scope/shared/pkg", 1)], ["@scope/shared/pkg"]),
    // a real key, but only inside ONE service → not cross-boundary
    file("a/z.ts", [anchor("/internal/only/here", 2)])
  ];
  const svc = new Map([
    ["a/x.ts", "a"],
    ["b/y.ts", "b"],
    ["a/z.ts", "a"]
  ]);
  const candidates = surfaceChannelCandidates(files, svc);
  assert.equal(candidates.length, 0);
});

test("normKey: universal normalization only (scheme/query/path-params/case), ≥2 segments", () => {
  assert.equal(normKey("https://host/api/v1/items?q=1#frag"), "api/v1/items");
  assert.equal(normKey("/Users/{id}/orders"), "users/{}/orders");
  assert.equal(normKey("/users/:userId/cart"), "users/{}/cart");
  assert.equal(normKey("singleword"), null); // <2 segments
  assert.equal(normKey("a b/c"), null); // whitespace
  assert.equal(normKey("{}/{}"), null); // all placeholder
});
