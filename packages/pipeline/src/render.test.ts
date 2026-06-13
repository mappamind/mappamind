import assert from "node:assert/strict";
import test from "node:test";

import type { Baseline } from "@mappamind_/baseline";
import type { ServiceGraph } from "@mappamind_/seam";

import { assertOfflineSafe } from "./offlineSafe.js";
import { renderStudioHtml } from "./render.js";

const baseline: Baseline = {
  schemaVersion: 1,
  workspaceId: "ws",
  derivedFrom: { factsHash: "h" },
  capabilities: [
    { id: "cap_checkout", name: "Checkout", summary: "places orders", members: [{ repo: "r", file: "checkout.go" }], provenance: "derived", confidence: "high" }
  ],
  edges: [],
  unknowns: [{ note: "unsure how refunds work" }]
};

const architecture: ServiceGraph = {
  services: ["src/checkout", "src/cart", "src/ghost"],
  edges: [{ from: "src/checkout", to: "src/cart", contract: "cart" }],
  dangling: [{ service: "src/checkout", contract: "ghost", file: "checkout.go", line: 10 }]
};

test("renders a self-contained page with title, mesh, capabilities, and unknowns", () => {
  const html = renderStudioHtml("demo-repo", baseline, architecture);
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes("demo-repo"));
  assert.ok(html.includes("Checkout"), "capability name");
  assert.ok(html.includes("places orders"), "capability summary");
  assert.ok(html.includes("checkout"), "mesh service node");
  assert.ok(html.includes("cart"), "mesh provider node");
  assert.ok(html.includes("unsure how refunds work"), "unknown");
  assert.ok(html.includes("<svg"), "an inline SVG mesh");
  // Offline-safe: no auto-loading resources; the feedback link is the only external href.
  assertOfflineSafe(html);
});

test("renders the app shell: sidebar nav, topbar breadcrumb, call-depth legend, footer", () => {
  const html = renderStudioHtml("demo-repo", baseline, architecture);
  assert.ok(html.includes(`class="sidebar"`), "sidebar");
  assert.ok(html.includes(`class="nav"`), "sidebar nav");
  assert.ok(html.includes(`class="topbar"`), "topbar");
  assert.ok(html.includes(`class="crumb"`), "breadcrumb");
  assert.ok(html.includes(`class="badge"`), "grounded badge");
  assert.ok(html.includes(`class="footrail"`), "footer rail");
  // The mesh legend states call depth; the canvas captions columns by depth, not
  // by invented semantic tiers. checkout (col 0) = ENTRY, cart (col 1) = DEPTH 2,
  // and the dangling ghost is the UNRESOLVED column.
  assert.ok(html.includes("column = call depth"), "call-depth legend");
  assert.ok(html.includes(">ENTRY<"), "entry column caption");
  assert.ok(html.includes(">DEPTH 2<"), "depth column caption");
  assert.ok(html.includes(">UNRESOLVED<"), "unresolved ghost caption");
  assert.ok(!html.includes("TRAFFIC") && !html.includes("ORCHESTRATION"), "no semantic tier claims");
  // Compact capability cards carry a `via` provenance line, not a file dump.
  assert.ok(html.includes(`class="via"`), "capability via line");
  // The dark toggle is CSS-only (no script): a checkbox + label drive it.
  assert.ok(html.includes(`id="mm-dark"`), "dark toggle input");
  assert.ok(html.includes("body:has(#mm-dark:checked)"), "css-only dark theme");
});

test("the meta line counts services, external boundaries, and capabilities", () => {
  const html = renderStudioHtml("demo-repo", baseline, architecture);
  // 3 services, 1 dangling contract (ghost), 1 capability.
  assert.ok(html.includes("3 services · 1 external · 1 capability"), "meta counts");
});

test("a dangling contract is drawn as an unresolved boundary node", () => {
  const html = renderStudioHtml("demo-repo", baseline, architecture);
  assert.ok(html.includes("ghost"), "the dangling contract label");
  assert.ok(html.includes("unresolved"), "labeled as unresolved");
});

test("an empty workspace renders without a mesh, no crash", () => {
  const html = renderStudioHtml("empty", baseline, { services: [], edges: [], dangling: [] });
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes("No services detected"), "calm empty state");
});

test("long service names widen their box and only truncate past the clamp", () => {
  // 21 chars: fits a widened box, no ellipsis.
  const mid = renderStudioHtml("m", baseline, {
    services: ["src/recommendationservice"],
    edges: [],
    dangling: []
  });
  assert.ok(mid.includes("recommendationservice"), "full label kept");
  assert.ok(!mid.includes("…"), "no truncation when it fits a widened box");

  // 30 chars: exceeds the max box width, so it ellipsizes rather than overflow.
  const long = renderStudioHtml("l", baseline, {
    services: [`src/${"x".repeat(30)}`],
    edges: [],
    dangling: []
  });
  assert.ok(long.includes("…"), "over-long label is truncated, never spills");
  assert.ok(long.includes('width="260"'), "box widened to the clamp");
});

test("escapes HTML in model-supplied text (no injection)", () => {
  const evil: Baseline = {
    ...baseline,
    capabilities: [{ id: "x", name: "<script>alert(1)</script>", summary: "a & b < c", members: [], provenance: "derived", confidence: "high" }]
  };
  const html = renderStudioHtml("t", evil, { services: [], edges: [], dangling: [] });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("a &amp; b &lt; c"));
});
