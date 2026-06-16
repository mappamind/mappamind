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
import { FONT_FACE } from "../packages/pipeline/dist/theme.js";

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
  `<a class="ex" href="${href}"><span class="cn c1"></span><span class="cn c2"></span><span class="cn c3"></span><span class="cn c4"></span>` +
  `<div class="extag ${tagClass}">${tag}</div><h3>${title}</h3><p>${desc}</p><span class="open">Open chart →</span></a>`;
// Self-contained paper grain (no external asset), matching the product surfaces.
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";
const index = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mappamind — live examples</title>
<style>${FONT_FACE}
:root{
  --bg:#07131b; --card:#0c1f2b; --line:rgba(124,178,186,0.16); --line-soft:rgba(124,178,186,0.09);
  --parch:#ece0c4; --ink:#dde6e3; --dim:#a3b4b5; --faint:#6d8284;
  --brass:#cea451; --brass-hi:#ecc472;
  --red:#e0785a; --green:#84b393; --blue:#74bcc4; --amber:#d6a44e;
  --display:"Cormorant","Iowan Old Style",Palatino,Georgia,serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box;margin:0}
body{font-family:Georgia,"Times New Roman",serif;line-height:1.6;color:var(--ink);-webkit-font-smoothing:antialiased;
  background:radial-gradient(120% 90% at 80% -10%,rgba(18,50,67,0.6) 0,transparent 55%),radial-gradient(130% 100% at 0% 110%,rgba(10,34,49,0.5) 0,transparent 50%),var(--bg)}
body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:0.06;mix-blend-mode:soft-light;background-image:${GRAIN}}
body::after{content:"";position:fixed;inset:0;pointer-events:none;background:radial-gradient(125% 110% at 50% 35%,transparent 55%,rgba(2,8,12,0.5) 100%)}
.wrap{position:relative;z-index:1;max-width:1040px;margin:0 auto;padding:64px 24px 90px}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:var(--brass);text-align:center;margin-bottom:18px}
.head{text-align:center;margin-bottom:50px}
.head h1{font-family:var(--display);font-weight:600;font-size:clamp(38px,6vw,60px);line-height:1.02;letter-spacing:-0.01em;color:var(--parch);margin-bottom:18px}
.head h1 em{font-style:italic;color:var(--brass-hi)}
.head p{font-size:17px;color:var(--dim);max-width:600px;margin:0 auto;text-wrap:pretty}
.head .sub{font-family:var(--mono);font-size:12px;letter-spacing:0.06em;margin-top:22px}
.head a{color:var(--brass-hi);text-decoration:none;border-bottom:1px solid var(--brass)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}
.ex{position:relative;display:block;text-decoration:none;color:inherit;background:linear-gradient(180deg,var(--card),#0a1a24);border:1px solid var(--line);padding:26px 26px 22px;transition:transform .15s ease,border-color .15s ease}
.ex::before{content:"";position:absolute;inset:6px;border:1px solid var(--line-soft);pointer-events:none}
.ex:hover{transform:translateY(-3px);border-color:var(--brass)}
.cn{position:absolute;width:9px;height:9px;border:1px solid var(--brass);opacity:0.65}
.cn.c1{top:-1px;left:-1px;border-right:0;border-bottom:0}.cn.c2{top:-1px;right:-1px;border-left:0;border-bottom:0}
.cn.c3{bottom:-1px;left:-1px;border-right:0;border-top:0}.cn.c4{bottom:-1px;right:-1px;border-left:0;border-top:0}
.extag{position:relative;display:inline-block;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;border-radius:999px;padding:4px 11px;margin-bottom:14px}
.extag.red{color:var(--red);background:rgba(224,120,90,0.14)}.extag.green{color:var(--green);background:rgba(132,179,147,0.14)}
.extag.blue{color:var(--blue);background:rgba(116,188,196,0.14)}.extag.amber{color:var(--amber);background:rgba(214,164,78,0.14)}
.ex h3{position:relative;font-family:var(--display);font-weight:600;font-size:21px;color:var(--parch);margin-bottom:8px;line-height:1.15}
.ex p{position:relative;font-size:14px;color:var(--dim);margin-bottom:16px}
.open{position:relative;font-family:var(--mono);font-size:12px;letter-spacing:0.06em;color:var(--brass-hi)}
.foot{text-align:center;margin-top:48px;font-family:var(--mono);font-size:11px;letter-spacing:0.07em;color:var(--faint)}
.foot a{color:var(--brass);text-decoration:none}
</style></head>
<body><div class="wrap">
<div class="eyebrow">A chart of your system · at the accept moment</div>
<div class="head">
<h1>See the <em>new world</em><br>your agent just drew.</h1>
<p>What an AI coding agent did to a system's architecture — grounded in real code, drawn the moment you decide whether to accept it. These are static example cards from a fictional storefront, exactly what Mappamind renders for your own repo.</p>
<p class="sub"><a href="https://github.com/mappamind/mappamind">← back to the repo</a></p>
</div>
<div class="grid">
${card("examples/shift-broken.html", "Broken channel", "red", "A rename broke a cross-service call", "An agent renamed a route on the provider but left two callers on the old path. The card flags the break and cites every stranded caller.")}
${card("examples/shift-multi.html", "Multiple breaks", "red", "Three boundaries broken at once", "One session that broke channels across three unrelated clusters — grouped by severity so nothing tangles, however many break.")}
${card("examples/shift-healthy.html", "Healthy", "green", "A calm, additive session", "An agent added a search service. Nothing existing changed — the card says so plainly instead of inventing alarm.")}
${card("examples/studio.html", "Studio", "blue", "The standing architecture", "The grounded picture a shift card diffs against: services, cross-service channels, and capabilities — every node backed by a real file:line.")}
</div>
<div class="foot">Every claim cites a real code fact — or it is struck from the chart. · <a href="https://github.com/mappamind/mappamind">github.com/mappamind/mappamind</a></div>
</div></body></html>`;
writeFileSync("docs/index.html", index);
writeFileSync("docs/.nojekyll", "");

console.log("wrote docs/index.html, docs/.nojekyll, and docs/examples/{shift-broken,shift-multi,shift-healthy,studio}.html");
