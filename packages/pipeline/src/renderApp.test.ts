import assert from "node:assert/strict";
import test from "node:test";

import type { Baseline } from "@mappamind_/baseline";
import type { SeamReport, ServiceGraph } from "@mappamind_/seam";

import { assertOfflineSafe } from "./offlineSafe.js";
import { renderAppHtml, type ShiftHistoryEntry } from "./renderApp.js";

const baseline: Baseline = {
  schemaVersion: 1,
  workspaceId: "ws",
  derivedFrom: { factsHash: "h" },
  capabilities: [
    {
      id: "cap_checkout",
      name: "Checkout",
      summary: "places orders",
      members: [{ repo: "app", file: "src/checkout/main.go", line: 12 }],
      provenance: "derived",
      confidence: "high"
    }
  ],
  edges: [],
  unknowns: [{ note: "unsure how refunds work" }]
};

const architecture: ServiceGraph = {
  services: ["src/checkout", "src/cart"],
  edges: [{ from: "src/checkout", to: "src/cart", contract: "cart" }],
  dangling: [{ service: "src/checkout", contract: "ghost", file: "src/checkout/main.go", line: 10 }]
};

const seams: SeamReport = {
  contracts: [
    {
      key: "validateoutfit",
      status: "in_sync",
      confidence: "high",
      seamType: "callable",
      crossesBoundary: true,
      references: [{ key: "validateoutfit", side: "reference", kind: "string-arg", repo: "web", file: "web/api.ts", line: 4 }],
      definitions: [{ key: "validateoutfit", side: "definition", kind: "export", repo: "backend", file: "functions/validate.js", line: 16 }]
    }
  ],
  dangling: []
};

const history: readonly ShiftHistoryEntry[] = [
  { at: "2026-06-10T18:30:00Z", severity: "local", title: "Theme to red", changedFiles: 3, affectedFiles: 5, brokenContracts: 0, cardFile: "2026-06-10T18-30-00Z.html" }
];

test("the app page has four CSS-only tabs and is offline/script-free", () => {
  const html = renderAppHtml({ title: "demo", baseline, architecture, seams, history });
  assert.match(html, /^<!doctype html>/);
  for (const id of ["tab-studio", "tab-shifts", "tab-caps", "tab-contracts"]) {
    assert.ok(html.includes(`id="${id}"`), `radio ${id}`);
    assert.ok(html.includes(`for="${id}"`), `nav label for ${id}`);
    assert.ok(html.includes(`#${id}:checked`), `:has() switch for ${id}`);
  }
  assert.ok(html.includes("body:has(#mm-dark:checked)"), "css-only dark theme");
  // Offline-safe: no auto-loading vectors; the feedback link is the only external href.
  assertOfflineSafe(html);
});

test("Studio tab carries the mesh; Capabilities tab carries file:line citations", () => {
  const html = renderAppHtml({ title: "demo", baseline, architecture, seams, history });
  assert.ok(html.includes("view-studio"), "studio view");
  assert.ok(html.includes("<svg"), "mesh svg");
  assert.ok(html.includes("view-caps"), "capabilities view");
  assert.ok(html.includes("src/checkout/main.go:12"), "a member citation with line");
  assert.ok(html.includes("derived · high"), "provenance + confidence tag");
});

test("Contracts tab lists seam contracts and unresolved externals", () => {
  const html = renderAppHtml({ title: "demo", baseline, architecture, seams, history });
  assert.ok(html.includes("view-contracts"), "contracts view");
  assert.ok(html.includes("validateoutfit"), "the contract key");
  assert.ok(html.includes("functions/validate.js:16"), "the definition location");
  assert.ok(html.includes("in sync"), "status label");
  assert.ok(html.includes("ghost"), "the unresolved external call");
});

test("Shifts tab links each session to its archived card", () => {
  const html = renderAppHtml({ title: "demo", baseline, architecture, seams, history });
  assert.ok(html.includes("view-shifts"), "shifts view");
  assert.ok(html.includes('href="shift/2026-06-10T18-30-00Z.html"'), "links to the archived card");
  assert.ok(html.includes("Theme to red"), "the session title");
  assert.ok(html.includes("3 changed · 5 affected"), "the session counts");
});

test("an empty workspace renders calm empty states, no crash", () => {
  const empty: Baseline = { ...baseline, capabilities: [], unknowns: [] };
  const html = renderAppHtml({
    title: "empty",
    baseline: empty,
    architecture: { services: [], edges: [], dangling: [] },
    seams: { contracts: [], dangling: [] },
    history: []
  });
  assert.match(html, /^<!doctype html>/);
  assert.ok(html.includes("No sessions recorded yet"), "empty shifts state");
  assert.ok(html.includes("No cross-boundary contracts"), "empty contracts state");
});

test("escapes model-supplied capability text (no injection)", () => {
  const evil: Baseline = {
    ...baseline,
    capabilities: [{ id: "x", name: "<script>alert(1)</script>", summary: "a & b < c", members: [], provenance: "derived", confidence: "high" }]
  };
  const html = renderAppHtml({ title: "t", baseline: evil, architecture, seams, history: [] });
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("a &amp; b &lt; c"));
});
