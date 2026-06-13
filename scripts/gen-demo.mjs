// Generate the public example gallery (GitHub Pages, served from /docs).
//
// Everything here is SYNTHETIC and FICTIONAL — a made-up storefront mesh — so the
// gallery never exposes any real or benchmark repository's names or structure. The
// pages are the product's own self-contained HTML (no JS, no external assets), so
// they drop straight onto Pages with no build. Run after `npm run build`:
//   node scripts/gen-demo.mjs
import { mkdirSync, writeFileSync } from "node:fs";

import { renderShiftCardHtml } from "../packages/pipeline/dist/renderShiftCard.js";
import { renderAppHtml } from "../packages/pipeline/dist/renderApp.js";

const OUT = "docs/examples";
mkdirSync(OUT, { recursive: true });

// ---- synthetic mesh (a fictional online store) -----------------------------------
const anchor = (svc, file, line, text) => ({ service: svc, file, line, text });
const ch = (key, kind, members) => ({
  key,
  kind,
  rationale: "",
  memberships: members.map((m) => ({ service: m.s, role: m.r, confidence: "verified", anchor: anchor(m.s, m.f, m.l, key) }))
});
function brokenChange(key, consumers, producer, prodFile) {
  const memberships = consumers.map((c) => ({ service: c.s, role: "consume", confidence: "verified", anchor: anchor(c.s, c.f, c.l, key) }));
  const prior = { key, kind: "http", rationale: "", memberships: [...memberships, { service: producer, role: "produce", confidence: "verified", anchor: anchor(producer, prodFile, 18, key) }] };
  return { change: "broken", channel: { key, kind: "http", rationale: "", memberships }, verified: false, lostRole: "produce", priorChannel: prior };
}
const sliceOf = (p) => ({ changedPaths: [], unknownPaths: [], affectedFiles: [], affectedCapabilities: [], atRiskContracts: [], atRiskServiceEdges: [], cosmetic: false, ...p });
const cardOf = (p) => ({ title: "", changedSummary: "", narration: "", narrationSource: "model", severity: "broad", baselineStale: false, impactedCapabilities: [], brokenContracts: [], channelChanges: [], ...p });

// ---- example 1: a single broken channel (also the README hero) --------------------
const broken = renderShiftCardHtml({
  card: cardOf({
    title: "Renamed the orders route — storefront and app still call the old one",
    changedSummary: "renamed /api/orders → /api/orders/v2 · orders-api/routes.ts · 1 file",
    narration:
      "The agent renamed the orders route on the provider but left two callers on the old path. storefront and the mobile app now request a route the orders service no longer serves.",
    impactedCapabilities: ["Checkout", "Order history"],
    channelChanges: [
      brokenChange("api/orders", [
        { s: "storefront", f: "storefront/src/api/orders.ts", l: 24 },
        { s: "mobile-app", f: "mobile-app/lib/data/orders.dart", l: 31 }
      ], "orders-api", "orders-api/src/routes.ts")
    ]
  }),
  slice: sliceOf({
    changedPaths: ["orders-api/src/routes.ts"],
    atRiskServiceEdges: [
      { consumer: "storefront", provider: "orders-api", contract: "api/orders" },
      { consumer: "mobile-app", provider: "orders-api", contract: "api/orders" }
    ]
  }),
  repoName: "shopmesh"
});
writeFileSync(`${OUT}/shift-broken.html`, broken);

// ---- example 2: several breaks across unrelated clusters --------------------------
const multi = renderShiftCardHtml({
  card: cardOf({
    title: "Refactor broke three service boundaries",
    changedSummary: "renamed api/catalog · removed payments-api · rerouted notifications · 9 files",
    narration:
      "The session renamed the catalog route, removed the payments provider, and rerouted notifications — leaving callers across three unrelated clusters pointing at routes nobody serves.",
    impactedCapabilities: ["Browse", "Checkout", "Payments", "Notifications"],
    brokenContracts: [
      { service: "orders-api", contract: "payments/charge", file: "orders-api/src/pay.ts", line: 51, kind: "internal-break", kindSource: "deterministic" },
      { service: "storefront", contract: "notify/email", file: "storefront/src/notify.ts", line: 12, kind: "internal-break", kindSource: "deterministic" }
    ],
    channelChanges: [
      brokenChange("api/catalog", [
        { s: "storefront", f: "storefront/src/api/catalog.ts", l: 9 },
        { s: "mobile-app", f: "mobile-app/lib/data/catalog.dart", l: 14 }
      ], "catalog-api", "catalog-api/src/routes.ts"),
      brokenChange("payments/charge", [{ s: "orders-api", f: "orders-api/src/pay.ts", l: 51 }], "payments-api", "payments-api/src/charge.ts"),
      brokenChange("notify/email", [{ s: "storefront", f: "storefront/src/notify.ts", l: 12 }], "notifications", "notifications/src/email.ts")
    ]
  }),
  slice: sliceOf({
    changedPaths: ["catalog-api/src/routes.ts", "payments-api", "notifications/src/email.ts"],
    atRiskServiceEdges: [
      { consumer: "storefront", provider: "catalog-api", contract: "api/catalog" },
      { consumer: "mobile-app", provider: "catalog-api", contract: "api/catalog" }
    ]
  }),
  repoName: "shopmesh"
});
writeFileSync(`${OUT}/shift-multi.html`, multi);

// ---- example 3: a calm, healthy session (growth, nothing broken) ------------------
const healthy = renderShiftCardHtml({
  card: cardOf({
    severity: "local",
    title: "Added product search — wired storefront to a new service",
    changedSummary: "added search-api · storefront/src/api/search.ts · 4 files",
    narration: "The agent added a search service and a storefront client for it. No existing channel changed; nothing downstream is at risk.",
    impactedCapabilities: ["Search"],
    channelChanges: [
      { change: "added", verified: true, channel: ch("api/search", "http", [
        { s: "search-api", r: "produce", f: "search-api/src/routes.ts", l: 8 },
        { s: "storefront", r: "consume", f: "storefront/src/api/search.ts", l: 5 }
      ]) }
    ]
  }),
  slice: sliceOf({
    changedPaths: ["search-api/src/routes.ts", "storefront/src/api/search.ts"],
    atRiskServiceEdges: []
  }),
  diff: { brokenContracts: [], lostEdges: [], newEdges: [{ from: "storefront", to: "search-api", contract: "api/search" }], removedServices: [], addedServices: ["search-api"] },
  repoName: "shopmesh"
});
writeFileSync(`${OUT}/shift-healthy.html`, healthy);

// ---- example 4: the Studio (the standing architecture at rest) --------------------
const channels = [
  ch("api/catalog", "http", [{ s: "catalog-api", r: "produce", f: "catalog-api/src/routes.ts", l: 18 }, { s: "storefront", r: "consume", f: "storefront/src/api/catalog.ts", l: 9 }, { s: "mobile-app", r: "consume", f: "mobile-app/lib/data/catalog.dart", l: 14 }]),
  ch("api/orders", "http", [{ s: "orders-api", r: "produce", f: "orders-api/src/routes.ts", l: 22 }, { s: "storefront", r: "consume", f: "storefront/src/api/orders.ts", l: 24 }]),
  ch("payments/charge", "http", [{ s: "payments-api", r: "produce", f: "payments-api/src/charge.ts", l: 11 }, { s: "orders-api", r: "consume", f: "orders-api/src/pay.ts", l: 51 }]),
  ch("api/inventory", "http", [{ s: "inventory-api", r: "produce", f: "inventory-api/src/stock.ts", l: 7 }, { s: "orders-api", r: "consume", f: "orders-api/src/reserve.ts", l: 33 }]),
  ch("api/auth", "http", [{ s: "auth-api", r: "produce", f: "auth-api/src/routes.ts", l: 5 }, { s: "storefront", r: "consume", f: "storefront/src/api/auth.ts", l: 8 }, { s: "mobile-app", r: "consume", f: "mobile-app/lib/data/auth.dart", l: 6 }])
];
const architecture = {
  services: ["storefront", "mobile-app", "catalog-api", "orders-api", "payments-api", "inventory-api", "auth-api"],
  edges: [
    { from: "storefront", to: "catalog-api", contract: "api/catalog" },
    { from: "mobile-app", to: "catalog-api", contract: "api/catalog" },
    { from: "storefront", to: "orders-api", contract: "api/orders" },
    { from: "orders-api", to: "payments-api", contract: "payments/charge" },
    { from: "orders-api", to: "inventory-api", contract: "api/inventory" },
    { from: "storefront", to: "auth-api", contract: "api/auth" },
    { from: "mobile-app", to: "auth-api", contract: "api/auth" }
  ],
  dangling: [{ service: "payments-api", contract: "stripe/charges", file: "payments-api/src/charge.ts", line: 14 }]
};
const cap = (name, summary, members) => ({ name, summary, provenance: "model", confidence: "high", members });
const baseline = {
  schemaVersion: 1,
  workspaceId: "shopmesh",
  derivedFrom: { factsHash: "demo" },
  capabilities: [
    cap("Browse catalog", "Customers list and search products; storefront and the mobile app both read the catalog service.", [{ repo: "shopmesh", file: "catalog-api/src/routes.ts", line: 18, symbol: "listItems" }, { repo: "shopmesh", file: "storefront/src/api/catalog.ts", line: 9, symbol: "getCatalog" }]),
    cap("Checkout", "Placing an order reserves inventory and charges payment.", [{ repo: "shopmesh", file: "orders-api/src/routes.ts", line: 22, symbol: "createOrder" }, { repo: "shopmesh", file: "orders-api/src/pay.ts", line: 51, symbol: "charge" }]),
    cap("Authentication", "Sign-in for the storefront and mobile app.", [{ repo: "shopmesh", file: "auth-api/src/routes.ts", line: 5, symbol: "login" }])
  ],
  edges: [],
  unknowns: []
};
writeFileSync(`${OUT}/studio.html`, renderAppHtml({ title: "shopmesh", baseline, architecture, seams: { contracts: [], orphans: [], unmatched: [] }, channels, history: [] }));

// ---- the gallery landing (docs/index.html) ---------------------------------------
const card = (href, tag, tagClass, title, desc) =>
  `<a class="ex" href="${href}"><div class="extag ${tagClass}">${tag}</div><h3>${title}</h3><p>${desc}</p><span class="open">Open example →</span></a>`;
const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mappamind — live examples</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{margin:0;font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#f6f7f9;color:#11161c;line-height:1.55}
@media (prefers-color-scheme:dark){body{background:#11151b;color:#e7ebf0}.ex{background:#1a1f27;border-color:#2a313c}.head p{color:#9aa6b2}.ex p{color:#9aa6b2}}
.wrap{max-width:1000px;margin:0 auto;padding:56px 24px 80px}
.head{text-align:center;margin-bottom:44px}
.head h1{font-size:30px;margin:0 0 10px;letter-spacing:-0.02em}
.head p{font-size:16px;color:#5b6770;margin:0 auto;max-width:620px}
.head .sub{font-size:13.5px;margin-top:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.ex{display:block;text-decoration:none;color:inherit;background:#fff;border:1px solid #e6e9ee;border-radius:16px;padding:22px 22px 20px;transition:transform .12s ease,box-shadow .12s ease}
.ex:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(20,30,50,.10)}
.extag{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:6px;padding:4px 9px;margin-bottom:12px}
.extag.red{color:#c0392b;background:#fdecea}.extag.amber{color:#9a6a00;background:#fbf0d9}.extag.green{color:#1f8a4c;background:#e6f6ec}.extag.blue{color:#2b6cb0;background:#e8f0fb}
.ex h3{margin:0 0 6px;font-size:17px}
.ex p{margin:0 0 14px;font-size:13.5px;color:#5b6770}
.open{font-size:13px;font-weight:600;color:#2f6df0}
.foot{text-align:center;margin-top:40px;font-size:13px;color:#7a8590}
.foot a{color:#2f6df0;text-decoration:none}
</style></head>
<body><div class="wrap">
<div class="head">
<h1>Mappamind — live examples</h1>
<p>See what an AI coding agent did to a system's architecture: grounded in real code, visual, shown at the accept moment. These are static example cards from a fictional storefront — exactly what Mappamind renders for your own repo.</p>
<p class="sub"><a href="https://github.com/mappamind/mappamind">← Back to the repo</a></p>
</div>
<div class="grid">
${card("examples/shift-broken.html", "Broken channel", "red", "A rename broke a cross-service call", "An agent renamed a route on the provider but left two callers on the old path. The card flags the break and cites every stranded caller.")}
${card("examples/shift-multi.html", "Multiple breaks", "red", "Three boundaries broken at once", "One session that broke channels across three unrelated clusters — grouped by severity so nothing tangles, however many break.")}
${card("examples/shift-healthy.html", "Healthy", "green", "A calm, additive session", "An agent added a search service. Nothing existing changed — the card says so plainly instead of inventing alarm.")}
${card("examples/studio.html", "Studio", "blue", "The standing architecture", "The grounded picture a shift card diffs against: services, cross-service channels, and capabilities — every node backed by a real file:line.")}
</div>
<div class="foot">Every claim cites a real code fact or it is dropped. <a href="https://github.com/mappamind/mappamind">github.com/mappamind/mappamind</a></div>
</div></body></html>`;
writeFileSync("docs/index.html", index);
writeFileSync("docs/.nojekyll", "");

console.log("wrote docs/index.html, docs/.nojekyll, and docs/examples/{shift-broken,shift-multi,shift-healthy,studio}.html");
