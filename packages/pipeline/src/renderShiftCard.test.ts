import assert from "node:assert/strict";
import test from "node:test";

import type { ChannelChange, ImpactSlice, MeshDiff, ShiftCard } from "@mappamind_/impact";

import { assertOfflineSafe } from "./offlineSafe.js";
import { renderShiftCardHtml } from "./renderShiftCard.js";

function sliceOf(partial: Partial<ImpactSlice>): ImpactSlice {
  return {
    changedPaths: [],
    unknownPaths: [],
    affectedFiles: [],
    affectedCapabilities: [],
    atRiskContracts: [],
    atRiskServiceEdges: [],
    cosmetic: true,
    ...partial
  };
}

function cardOf(partial: Partial<ShiftCard>): ShiftCard {
  return {
    title: "A change",
    changedSummary: "1 file changed",
    narration: "Something happened.",
    narrationSource: "model",
    severity: "local",
    baselineStale: false,
    impactedCapabilities: [],
    brokenContracts: [],
    channelChanges: [],
    ...partial
  };
}

// ---- S1: the silent contract break ------------------------------------------------

const s1Diff: MeshDiff = {
  brokenContracts: [
    { service: "src/checkoutservice", contract: "shipping", file: "src/checkoutservice/main.go", line: 314 },
    { service: "src/frontend", contract: "shipping", file: "src/frontend/rpc.go", line: 88 }
  ],
  lostEdges: [
    { from: "src/checkoutservice", to: "src/shippingservice", contract: "shipping" },
    { from: "src/frontend", to: "src/shippingservice", contract: "shipping" }
  ],
  newEdges: [],
  removedServices: ["src/shippingservice"],
  addedServices: ["src/logisticsservice"]
};

const s1Card = cardOf({
  title: "Rename broke shipping for checkout and frontend",
  changedSummary: "renamed src/shippingservice → src/logisticsservice · 7 files",
  narration: "The rename did not update two callers.",
  severity: "broad",
  impactedCapabilities: ["Checkout", "Shipping"],
  brokenContracts: [
    { service: "src/checkoutservice", contract: "shipping", file: "src/checkoutservice/main.go", line: 314, kind: "internal-break", kindSource: "deterministic" },
    { service: "src/frontend", contract: "shipping", file: "src/frontend/rpc.go", line: 88, kind: "internal-break", kindSource: "deterministic" }
  ]
});

const s1Slice = sliceOf({ changedPaths: ["src/shippingservice/main.go"], cosmetic: false });

test("S1: a real break earns the red tag and the flow picture", () => {
  const html = renderShiftCardHtml({ card: s1Card, slice: s1Slice, diff: s1Diff });
  assert.ok(html.includes('class="sev-tag sev-red">BROAD<'));
  assert.ok(html.includes("2 contracts broken"));
  assert.ok(html.includes("1 service removed"));
  assert.ok(html.includes("CALLS FLOW"));
  assert.ok(html.includes("Provider removed")); // the broken block carries the warning, never "No issues"
  assert.ok(html.includes("checkoutservice")); // the stranded consumer is named as a chip in that block
  assert.ok(html.includes("Added · no callers yet"));
  assert.ok(html.includes("main.go:314"));
  assert.ok(html.includes("src/frontend/rpc.go:88")); // evidence receipt
  assert.ok(html.includes("Checkout")); // behavior chips
});

test("S1: context services render as the dimmed UNCHANGED band, never as affected", () => {
  const html = renderShiftCardHtml({
    card: s1Card,
    slice: s1Slice,
    diff: s1Diff,
    contextServices: ["src/cartservice", "src/paymentservice", "src/adservice"]
  });
  assert.ok(html.includes("UNCHANGED · 3 SERVICES"));
  assert.ok(html.includes(">cartservice<"));
  assert.ok(!html.includes("AFFECTED SURFACES"));
});

test("render is deterministic: same input, same bytes", () => {
  const a = renderShiftCardHtml({ card: s1Card, slice: s1Slice, diff: s1Diff });
  const b = renderShiftCardHtml({ card: s1Card, slice: s1Slice, diff: s1Diff });
  assert.equal(a, b);
});

// ---- S2: advisory ripple -----------------------------------------------------------

test("S2: advisory breadth wears amber, never red, and shows exact depth bands", () => {
  const affectedFiles = [
    ...["auth/middleware.ts", "billing/client.ts", "routes/admin.ts", "a.ts", "b.ts"].map((path) => ({ path, depth: 1 })),
    ...Array.from({ length: 14 }, (_, i) => ({ path: `d2/f${i}.ts`, depth: 2 })),
    ...Array.from({ length: 11 }, (_, i) => ({ path: `d3/f${i}.ts`, depth: 3 }))
  ];
  const card = cardOf({
    severity: "broad",
    impactedCapabilities: ["Auth", "Billing"],
    narration: "No contracts are broken."
  });
  const slice = sliceOf({ changedPaths: ["api-gateway/src/http.ts"], affectedFiles, cosmetic: false });
  const html = renderShiftCardHtml({ card, slice });
  assert.ok(html.includes("BROAD · ADVISORY"));
  assert.ok(html.includes("sev-amber"));
  assert.ok(!html.includes('sev-tag sev-red'));
  assert.ok(html.includes("IMPORT REACH · BY DEPTH"));
  assert.ok(html.includes("<b>5</b>depth 1"));
  assert.ok(html.includes("<b>14</b>depth 2"));
  assert.ok(html.includes("+11 more")); // band caps surface, never silent
  assert.ok(html.includes("0 contracts broken"));
  assert.ok(html.includes("30 files within reach"));
});

// ---- S3: monster ripple ------------------------------------------------------------

test("S3: past 50 files the picture becomes rollup stats with exact counts", () => {
  const affectedFiles = [
    ...Array.from({ length: 5 }, (_, i) => ({ path: `lib/direct${i}.dart`, depth: 1 })),
    ...Array.from({ length: 38 }, (_, i) => ({ path: `lib/d2/f${i}.dart`, depth: 2 })),
    ...Array.from({ length: 97 }, (_, i) => ({ path: `lib/d3/f${i}.dart`, depth: 3 })),
    ...Array.from({ length: 84 }, (_, i) => ({ path: `lib/d4/f${i}.dart`, depth: 4 }))
  ];
  const card = cardOf({ severity: "broad", impactedCapabilities: ["Immersive Home"] });
  const slice = sliceOf({
    changedPaths: ["lib/features/home/widgets/immersive_header.dart"],
    unknownPaths: ["assets/logo.png"],
    affectedFiles,
    affectedCapabilities: [{ id: "c1", name: "Immersive Home", viaFiles: ["lib/direct0.dart"] }],
    reExportCarriers: Array.from({ length: 12 }, (_, i) => `lib/barrels/index${i}.dart`),
    cosmetic: false
  });
  const html = renderShiftCardHtml({ card, slice });
  assert.ok(html.includes("BLAST RADIUS · AGGREGATED"));
  assert.ok(html.includes(">224<")); // the number is the message
  assert.ok(html.includes(">12<"));
  assert.ok(html.includes("barrel re-exports carry it"));
  assert.ok(html.includes("capability · Immersive Home"));
  assert.ok(html.includes('<span class="dlabel">depth 3</span>'));
  assert.ok(html.includes('<span class="dcount">97</span>'));
  assert.ok(html.includes("SURFACES TO CHECK · DIRECT IMPORTERS"));
  assert.ok(html.includes("1 non-code file also changed"));
});

// ---- S4: external SDK adoption -----------------------------------------------------

test("S4: external adoption is blue and informational — zero alarm color", () => {
  const card = cardOf({
    title: "configservice now depends on Secret Manager",
    severity: "local",
    brokenContracts: [
      { service: "src/configservice", contract: "secretmanager", file: "internal/config/secrets.go", line: 41, kind: "external-service", kindSource: "model" }
    ]
  });
  const diff: MeshDiff = { brokenContracts: [{ service: "src/configservice", contract: "secretmanager", file: "internal/config/secrets.go", line: 41 }], lostEdges: [], newEdges: [], removedServices: [], addedServices: [] };
  const slice = sliceOf({ changedPaths: ["internal/config/secrets.go"] });
  const html = renderShiftCardHtml({ card, slice, diff });
  assert.ok(html.includes('class="sev-tag sev-blue">LOCAL<'));
  assert.ok(html.includes("informational"));
  assert.ok(html.includes("External · outside this workspace"));
  assert.ok(html.includes("model-judged"));
  assert.ok(!html.includes('sev-tag sev-red'));
  assert.ok(!html.includes("Provider removed"));
});

test("evidence caps surface external dependencies and added services", () => {
  const card = cardOf({
    severity: "local",
    brokenContracts: Array.from({ length: 5 }, (_, index) => ({
      service: "src/configservice",
      contract: `external${index}`,
      file: `internal/config/external${index}.go`,
      line: 40 + index,
      kind: "external-service",
      kindSource: "model"
    }))
  });
  const diff: MeshDiff = {
    brokenContracts: card.brokenContracts.map((contract) => ({
      service: contract.service,
      contract: contract.contract,
      file: contract.file,
      line: contract.line
    })),
    lostEdges: [],
    newEdges: [],
    removedServices: [],
    addedServices: Array.from({ length: 5 }, (_, index) => `src/newservice${index}`)
  };
  const html = renderShiftCardHtml({
    card,
    slice: sliceOf({ changedPaths: ["internal/config/secrets.go"] }),
    diff
  });
  assert.ok(html.includes("+1 more external-service call sites"));
  assert.ok(html.includes("+1 more added services"));
});

// ---- honesty + safety --------------------------------------------------------------

test("honesty rail: stale baseline and a deterministic narration are admitted", () => {
  const card = cardOf({ severity: "broad", baselineStale: true, narrationSource: "deterministic" });
  const slice = sliceOf({ changedPaths: ["a.ts"], affectedFiles: [{ path: "b.ts", depth: 1 }], cosmetic: false });
  const html = renderShiftCardHtml({ card, slice });
  assert.ok(html.includes("Baseline stale"));
  assert.ok(html.includes("narration: deterministic fallback"));
  const fresh = renderShiftCardHtml({ card: cardOf({}), slice });
  assert.ok(fresh.includes("Baseline fresh"));
});

test("all user-controlled content is HTML-escaped", () => {
  const card = cardOf({
    title: `<script>alert(1)</script>`,
    narration: `a & b < c`,
    impactedCapabilities: [`<b>Cap</b>`]
  });
  const slice = sliceOf({ changedPaths: [`bad/<img src=x>.ts`], affectedFiles: [{ path: `dep/<svg>.ts`, depth: 1 }], cosmetic: false });
  const html = renderShiftCardHtml({ card, slice });
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!html.includes("<img src=x>"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("a cosmetic card still renders minimal and honest (the runner folds it)", () => {
  const card = cardOf({ severity: "cosmetic", title: "No downstream impact", narration: "Nothing downstream was affected.", narrationSource: "deterministic" });
  const html = renderShiftCardHtml({ card, slice: sliceOf({ changedPaths: ["leaf.ts"] }) });
  assert.ok(html.includes("COSMETIC"));
  assert.ok(!html.includes("CALLS FLOW"));
  assert.ok(!html.includes("IMPORT REACH"));
  assert.ok(html.includes("Nothing downstream was affected."));
  // a cosmetic card never admits a "deterministic fallback" — no model call was due
  assert.ok(!html.includes("deterministic fallback"));
});

test("at-risk-only mesh flow renders amber with no red anywhere", () => {
  const card = cardOf({ severity: "broad" });
  const slice = sliceOf({
    changedPaths: ["src/shippingservice/quote.go"],
    atRiskServiceEdges: [{ consumer: "src/frontend", provider: "src/shippingservice", contract: "shipping" }],
    cosmetic: false
  });
  const html = renderShiftCardHtml({ card, slice });
  assert.ok(html.includes("CALLS FLOW"));
  assert.ok(html.includes("frontend")); // the at-risk consumer is named as an amber chip
  assert.ok(html.includes("Provider changed this session"));
  assert.ok(html.includes("BROAD · ADVISORY"));
  assert.ok(!html.includes('sev-tag sev-red'));
  assert.ok(!html.includes("Calls removed provider"));
});

test("the card carries no verdict UI and stays offline-safe", () => {
  const html = renderShiftCardHtml({ card: cardOf({}), slice: sliceOf({ changedPaths: ["a.ts"], cosmetic: false }) });
  // The verdict loop was removed for v0.1: a static card implied a clickable,
  // learning feedback loop that isn't built (corrections were never consumed). The
  // card is the honest picture; the human decides in their agent, and the footer
  // feedback link is the real channel.
  assert.ok(!html.includes("RECORD YOUR VERDICT"), "no verdict panel");
  assert.ok(!html.includes("mappamind verdict"), "no verdict commands");
  // The accept-moment surface must be fully offline-safe: no <script>, no <img>/<link>/
  // <iframe>, no external src/url(), and the feedback link as the only external href.
  assertOfflineSafe(html);
});

// ---- the diff-first hero: verified channel changes with inline proof -------------

const channelChange: ChannelChange = {
  change: "changed",
  verified: true,
  channel: {
    key: "api/catalog/items/by",
    kind: "http",
    rationale: "checkout's catalog client now calls a renamed route",
    memberships: [
      { service: "catalog", role: "produce", confidence: "verified", anchor: { service: "catalog", file: "src/Catalog.API/Apis/CatalogApi.cs", line: 31, text: "/api/catalog/items/by-ids" } },
      { service: "web", role: "consume", confidence: "verified", anchor: { service: "web", file: "src/WebApp/Services/CatalogService.cs", line: 26, text: "/api/catalog/items/by" } }
    ]
  }
};

test("the hero renders a changed channel with both cited proof lines and a verified pill", () => {
  const html = renderShiftCardHtml({
    card: cardOf({ channelChanges: [channelChange] }),
    slice: sliceOf({ changedPaths: ["src/Catalog.API/Apis/CatalogApi.cs"], cosmetic: false })
  });
  assert.ok(html.includes("CHANNEL CHANGES"), "hero section header");
  assert.ok(html.includes("Verified · anchors re-found"), "verified existence pill");
  assert.ok(html.includes("relation inferred"), "relation is labelled inferred, not certain");
  // both cited spans appear inline as the proof (the trust unit, §I3)
  assert.ok(html.includes("src/Catalog.API/Apis/CatalogApi.cs:31"), "producer proof line");
  assert.ok(html.includes("src/WebApp/Services/CatalogService.cs:26"), "consumer proof line");
  assert.ok(html.includes("/api/catalog/items/by-ids"), "producer cited text");
  // still fully offline-safe with the new hero markup
  assertOfflineSafe(html);
});

test("no channel changes → no hero section, card still renders", () => {
  const html = renderShiftCardHtml({ card: cardOf({ channelChanges: [] }), slice: sliceOf({ changedPaths: ["a.ts"], cosmetic: false }) });
  assert.ok(!html.includes("CHANNEL CHANGES"), "hero omitted when there are no channel changes");
  assertOfflineSafe(html);
});
