// The shared Mappamind design system: one token set, one app shell, reused by
// every rendered surface (the Studio app page and the shift card). Extracted so
// the Studio and the card stop looking like two different products — they share
// the same chrome, the same light/dark toggle (CSS-only, no <script>), and the
// same offline, self-contained guarantee.
//
// Content-specific CSS (the Studio sections, the shift card components) lives in
// each renderer and is appended via renderShell's `headExtra`. Those two content
// stylesheets never appear on the same page, so their class names can't collide;
// only genuinely shared chrome lives here.

export function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Strip the container prefix so a node reads "checkout", not "src/checkout".
export function short(service: string): string {
  return service.replace(/^(src|services|service|apps|app|packages|cmd|internal|lib)\//, "");
}

export function initials(title: string): string {
  const words = title.replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "MM";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

// ---- tokens: one palette, light by default, dark via the CSS-only toggle -----------

export const TOKENS_CSS = `:root{
  --bg: oklch(96.8% 0.005 255); --shell: oklch(99.5% 0.001 255); --card: oklch(100% 0 0); --card2: oklch(100% 0 0);
  --line: oklch(92.5% 0.006 255); --line-soft: oklch(95.5% 0.004 255);
  --ink: oklch(28% 0.03 262); --dim: oklch(48% 0.022 262); --faint: oklch(62% 0.018 262);
  --blue: oklch(54% 0.18 258); --blue-soft: oklch(96% 0.03 258);
  --green: oklch(57% 0.15 152); --green-soft: oklch(96% 0.04 152);
  --red: oklch(58% 0.21 27); --red-soft: oklch(96.5% 0.03 27);
  --amber: oklch(58% 0.14 80); --amber-soft: oklch(96.5% 0.04 75);
  --violet: oklch(55% 0.17 295); --indigo: oklch(50% 0.17 270);
  --teal: oklch(58% 0.11 195); --cyan: oklch(56% 0.12 230);
  --slate: oklch(55% 0.03 255); --slate-soft: oklch(95% 0.008 255);
  --shadow-sm: 0 1px 2px oklch(40% 0.03 262 / 0.06), 0 1px 1px oklch(40% 0.03 262 / 0.04);
  --shadow: 0 1px 2px oklch(40% 0.03 262 / 0.06), 0 6px 20px oklch(40% 0.03 262 / 0.07);
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Helvetica, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --r: 14px;
}
body:has(#mm-dark:checked){
  --bg: oklch(18% 0.012 262); --shell: oklch(20.5% 0.014 262); --card: oklch(23% 0.016 262); --card2: oklch(23% 0.016 262);
  --line: oklch(31% 0.018 262); --line-soft: oklch(27% 0.016 262);
  --ink: oklch(93% 0.01 262); --dim: oklch(72% 0.014 262); --faint: oklch(58% 0.016 262);
  --blue: oklch(70% 0.15 258); --blue-soft: oklch(34% 0.06 258);
  --green: oklch(72% 0.15 152); --green-soft: oklch(34% 0.07 152);
  --red: oklch(68% 0.20 27); --red-soft: oklch(34% 0.08 27);
  --amber: oklch(76% 0.14 70); --amber-soft: oklch(36% 0.06 70);
  --violet: oklch(72% 0.13 295); --indigo: oklch(68% 0.14 270);
  --teal: oklch(72% 0.10 195); --cyan: oklch(72% 0.11 230);
  --slate: oklch(70% 0.03 255); --slate-soft: oklch(28% 0.02 255);
  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.3);
  --shadow: 0 2px 4px oklch(0% 0 0 / 0.3), 0 8px 24px oklch(0% 0 0 / 0.28);
}`;

// ---- shell chrome: the app frame shared by every page ------------------------------

export const SHELL_CSS = `@media print{ .sidebar,.topbar{display:none} body{background:white} }
*{box-sizing:border-box; margin:0}
body{background:var(--bg); color:var(--ink); font-family:var(--sans); -webkit-font-smoothing:antialiased}
#mm-dark,.mm-tab{position:absolute; opacity:0; pointer-events:none; width:0; height:0}
.app{display:grid; grid-template-columns:232px 1fr; min-height:100vh}
.sidebar{background:var(--shell); border-right:1px solid var(--line); padding:20px 14px; display:flex; flex-direction:column; gap:4px; position:sticky; top:0; height:100vh}
.brand{display:flex; align-items:center; gap:9px; padding:4px 8px 18px}
.brand .logo{width:34px; height:34px; flex:none}
.brand b{font-size:17px; font-weight:600; letter-spacing:-0.02em; color:var(--ink)}
.brand b i{font-style:normal; background:linear-gradient(90deg, var(--blue), var(--violet)); -webkit-background-clip:text; background-clip:text; color:transparent}
.nav{display:flex; flex-direction:column; gap:2px}
.navlink{display:flex; align-items:center; gap:11px; padding:8px 11px; border-radius:9px; color:var(--dim); font-size:13.5px; text-decoration:none; font-weight:500; cursor:pointer; user-select:none}
.navlink svg{width:17px; height:17px; stroke:currentColor; fill:none; stroke-width:1.7; opacity:0.85}
.navlink:hover{background:var(--line-soft); color:var(--ink)}
.navlink.on{background:var(--blue); color:white; box-shadow:var(--shadow-sm)}
.navlink.on svg{opacity:1}
.side-card{margin-top:auto; background:var(--blue-soft); border:1px solid var(--line); border-radius:12px; padding:14px; display:flex; gap:11px; align-items:flex-start}
.side-card .cloud{width:30px; height:30px; flex:none; border-radius:8px; background:var(--card); display:grid; place-items:center; box-shadow:var(--shadow-sm)}
.side-card .cloud svg{width:18px; height:18px; stroke:var(--blue); fill:none; stroke-width:1.6}
.side-card p{font-size:11.5px; line-height:1.45; color:var(--dim)}
.side-card a{display:block; margin-top:6px; font-size:11.5px; color:var(--blue); text-decoration:none; font-weight:600}
.main{min-width:0; display:flex; flex-direction:column}
.topbar{display:flex; align-items:center; gap:12px; padding:14px 26px; border-bottom:1px solid var(--line); background:var(--shell); position:sticky; top:0; z-index:5}
.crumb{font-size:13.5px; color:var(--faint); font-weight:500}
.crumb b{color:var(--ink); font-weight:600}
.crumb .sep{margin:0 8px; opacity:0.5}
.topbar .spacer{flex:1}
.pill{font-family:var(--sans); font-size:12.5px; color:var(--dim); font-weight:550; border:1px solid var(--line); border-radius:9px; padding:6px 12px; background:var(--card); cursor:pointer; display:inline-flex; align-items:center; gap:7px; user-select:none}
.pill svg{width:13px; height:13px; stroke:var(--faint); fill:none; stroke-width:1.8}
.pill .sun{display:none}
body:has(#mm-dark:checked) .pill .sun{display:inline}
body:has(#mm-dark:checked) .pill .moon{display:none}
.avatar{width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg, var(--violet), var(--blue)); color:white; display:grid; place-items:center; font-size:12px; font-weight:650; position:relative}
.avatar::after{content:""; position:absolute; right:-1px; bottom:-1px; width:9px; height:9px; border-radius:50%; background:var(--green); border:2px solid var(--shell)}
.content{padding:26px; display:flex; flex-direction:column; gap:18px; max-width:1320px; width:100%}
.card{background:var(--card); border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--shadow-sm)}
.sect-title{font-size:11px; font-weight:650; letter-spacing:0.09em; color:var(--faint)}
.ft-link{font-family:var(--sans); font-size:11px; font-weight:600; color:var(--blue); text-decoration:none}
.ft-link:hover{text-decoration:underline}
@media (max-width:760px){
  .app{grid-template-columns:1fr}
  .sidebar{position:static; height:auto; flex-direction:row; flex-wrap:wrap; align-items:center; gap:6px; padding:12px 14px; border-right:none; border-bottom:1px solid var(--line)}
  .brand{padding:0 8px 0 0}
  .side-card{display:none}
  .nav{flex-direction:row; flex-wrap:wrap; gap:4px; flex:1}
  .navlink{padding:7px 10px; font-size:13px}
  .content{padding:18px}
}`;

export const SYMBOLS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-shift" viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 14 2-8h6"/></symbol>
<symbol id="i-service" viewBox="0 0 24 24"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M7.5 8 11 16M16.5 8 13 16M8 6h8"/></symbol>
<symbol id="i-grid" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></symbol>
<symbol id="i-contract" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M9 9h6M9 13h6M9 17h4"/></symbol>
<symbol id="i-cloud" viewBox="0 0 24 24"><path d="M7 18a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1A3.5 3.5 0 0 1 18 18z"/></symbol>
<symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 2 4 5v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V5z"/><path d="M9 12l2 2 4-4"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></symbol>
</defs></svg>`;

// The mark: the real mappamind logo (assets/logo-mark.png) downscaled to 48px and
// inlined as an SVG <image> data-uri — an EXACT match, ~6 KB, self-contained. We embed
// the raster (not a vector recreation) because the brand mark is a rendered image; the
// full-res asset is ~1 MB, far too heavy for every offline card. <image>+data: passes
// the offline-safety check (only <img>/<link>/<iframe> and external https are banned).
export const LOGO = `<svg class="logo" viewBox="0 0 48 48" fill="none" aria-hidden="true"><image href="data:image/png;base64,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" width="48" height="48"/></svg>`;

// ---- the single allowed external link ----------------------------------------------
// The ONLY http(s) link rendered on a surface. The offline-invariant tests pin it as
// the sole external href: it is navigation, never an auto-loading resource. Set the
// owner once the public org is final; both footers and the tests import this constant.
export const FEEDBACK_URL = "https://github.com/mappamind/mappamind/discussions";

export function feedbackLink(): string {
  return `<a class="ft-link" href="${FEEDBACK_URL}">Feedback</a>`;
}

// ---- nav items + the shell wrapper -------------------------------------------------

export type NavItem = {
  readonly icon: string;
  readonly label: string;
  readonly href?: string; // a real link (archived card pages nav back to the app)
  readonly forId?: string; // a tab radio id (the single-page app)
  readonly active?: boolean; // static highlight (link mode); tab mode highlights via :has
};

export function navItem(item: NavItem): string {
  const inner = `<svg><use href="#${item.icon}"></use></svg>${escape(item.label)}`;
  const on = item.active ? " on" : "";
  if (item.forId) {
    return `<label class="navlink${on}" for="${item.forId}">${inner}</label>`;
  }
  return `<a class="navlink${on}" href="${item.href ?? "#"}">${inner}</a>`;
}

export type ShellOptions = {
  readonly title: string;
  readonly crumb: string; // inner HTML for the breadcrumb (e.g. "<b>Studio</b><span class='sep'>/</span>name")
  readonly navHtml: string; // built from navItem()
  readonly content: string; // everything after the topbar (its own .content/.shift wrapper)
  readonly headExtra?: string; // content-specific CSS
  readonly preBody?: string; // raw HTML before .app (tab radios)
  readonly topbarExtra?: string; // extra topbar controls, left of the theme pill
  readonly sideCard?: string; // side-card inner HTML
};

export function renderShell(o: ShellOptions): string {
  const sideCard = o.sideCard ?? "<p>The system at rest. The shift card diffs against this baseline.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escape(o.title)}</title>
<style>${TOKENS_CSS}
${SHELL_CSS}
${o.headExtra ?? ""}</style></head><body>
<input type="checkbox" id="mm-dark" aria-hidden="true" tabindex="-1">
${o.preBody ?? ""}
${SYMBOLS}
<div class="app">
  <aside class="sidebar">
    <div class="brand">${LOGO}<b>mappa<i>mind</i></b></div>
    <nav class="nav">${o.navHtml}</nav>
    <div class="side-card"><span class="cloud"><svg><use href="#i-cloud"></use></svg></span><div>${sideCard}</div></div>
  </aside>
  <div class="main">
    <div class="topbar">
      <span class="crumb">${o.crumb}</span>
      <span class="spacer"></span>
      ${o.topbarExtra ?? ""}
      <label class="pill" for="mm-dark"><svg class="moon"><use href="#i-moon"></use></svg><svg class="sun"><use href="#i-sun"></use></svg>Theme</label>
      <div class="avatar">${escape(initials(o.title))}</div>
    </div>
    ${o.content}
  </div>
</div>
</body></html>`;
}
