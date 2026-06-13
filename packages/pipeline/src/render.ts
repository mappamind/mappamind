// The Studio: a baseline + service mesh as the standing picture of the system.
//
// This module owns the Studio's CONTENT (header, tiered mesh, capability cards,
// unknowns, footer) and its content CSS. The app shell (sidebar, topbar, theme
// toggle, tokens) comes from theme.ts and is shared with the shift card, so the
// two surfaces are one consistent product. `renderStudioHtml` wraps the content
// in that shell for the standalone Studio page; `studioContent`/`STUDIO_CSS` are
// reused by the single-page app (renderApp.ts).
//
// Self-contained and offline-safe: inline SVG, no external assets, no <script>
// (the dark toggle and tabs are CSS-only). The mesh tiers are call-graph depth,
// not an invented taxonomy.

import type { Baseline, Capability } from "@mappamind_/baseline";
import type { ServiceGraph } from "@mappamind_/seam";

import { escape, feedbackLink, renderShell, short, navItem } from "./theme.js";

// Last path segment of a member file's directory — a rough "where it lives" label.
function dirOf(file: string): string {
  const parts = file.split("/").filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? file;
  return parts[0]!;
}

// A compact provenance line for a capability: where it lives + how many files.
export function viaLine(cap: Capability): string {
  const files = new Set(cap.members.map((m) => `${m.repo}/${m.file}`));
  const dirs = [...new Set(cap.members.map((m) => short(dirOf(m.file))))].filter(Boolean);
  const count = files.size;
  const unit = count === 1 ? "file" : "files";
  if (dirs.length === 0) return `${count} ${unit}`;
  const shown = dirs.slice(0, 2).join(" · ");
  const extra = dirs.length > 2 ? ` +${dirs.length - 2}` : "";
  return `${shown}${extra} — ${count} ${unit}`;
}

// ---- mesh layout: layer services by call-graph depth, size boxes to labels --------

// Column = call depth (left → right). Color is a depth gradient only — it makes
// adjacent columns legible; it does NOT claim a semantic tier (the honest rename:
// column 0 = ENTRY, columns 1..N = DEPTH n, the dashed ghost column = UNRESOLVED).
const TIER_COLORS = ["var(--violet)", "var(--blue)", "var(--indigo)", "var(--teal)", "var(--cyan)"];

// Caption for a real (non-ghost) column: column 0 is the entry layer; deeper
// columns are labelled by call depth (column 1 → "DEPTH 2", matching "calls flow
// left → right"). The dashed ghost column is captioned UNRESOLVED separately.
function columnCaption(col: number): string {
  return col === 0 ? "ENTRY" : `DEPTH ${col + 1}`;
}

const BOX_H = 38;
const COL_GAP = 36;
const ROW_GAP = 14;
const PAD_X = 24;
const TOP = 40; // room for the tier caption row
const CHAR_W = 7.6; // approx mono glyph advance at 12.5px
const TEXT_X = 30; // label starts here (dot sits at +18)
const TEXT_PAD = 14; // right breathing room
const MIN_BOX = 140;
const MAX_BOX = 260;

// Box width that fits the longest label in a column (clamped); the SVG viewBox
// scales the whole canvas down, so wider columns never cause page scroll.
function boxWidthFor(maxChars: number): number {
  return Math.max(MIN_BOX, Math.min(MAX_BOX, Math.round(TEXT_X + maxChars * CHAR_W + TEXT_PAD)));
}

// Hard cap: a label longer than the (clamped) box can show gets an ellipsis, so
// text never spills past the node border.
function fitLabel(label: string, boxW: number): string {
  const maxChars = Math.floor((boxW - TEXT_X - TEXT_PAD) / CHAR_W);
  if (label.length <= maxChars) return label;
  return `${label.slice(0, Math.max(1, maxChars - 1))}…`;
}

function assignColumns(services: readonly string[], edges: ServiceGraph["edges"]): Map<string, number> {
  const col = new Map<string, number>();
  for (const svc of services) col.set(svc, 0);
  const maxIter = services.length + 1;
  for (let i = 0; i < maxIter; i += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!col.has(edge.from) || !col.has(edge.to) || edge.from === edge.to) continue;
      const want = col.get(edge.from)! + 1;
      if (want > col.get(edge.to)!) {
        col.set(edge.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return col;
}

type Placed = { readonly name: string; readonly label: string; readonly x: number; readonly y: number; readonly w: number; readonly col: number };
type Ghost = { readonly label: string; readonly x: number; readonly y: number; readonly w: number };

type MeshLayout = {
  readonly placed: Map<string, Placed>;
  readonly ghosts: Map<string, Ghost>;
  readonly usedCols: readonly number[];
  readonly colX: readonly number[];
  readonly width: number;
  readonly height: number;
};

function layout(graph: ServiceGraph): MeshLayout {
  const services = [...graph.services].sort();
  const colOf = assignColumns(services, graph.edges);

  const byCol = new Map<number, string[]>();
  let maxCol = 0;
  for (const svc of services) {
    const c = colOf.get(svc) ?? 0;
    maxCol = Math.max(maxCol, c);
    (byCol.get(c) ?? byCol.set(c, []).get(c)!).push(svc);
  }

  // Ghost column for dangling contracts (unresolved/external boundaries).
  const ghostLabels = [...new Set(graph.dangling.map((d) => d.contract))];
  const ghostCol = maxCol + 1;
  const hasGhosts = ghostLabels.length > 0;
  const lastCol = hasGhosts ? ghostCol : maxCol;

  // Per-column box width from the longest label in that column.
  const colWidth: number[] = [];
  for (let c = 0; c <= maxCol; c += 1) {
    const names = byCol.get(c) ?? [];
    const maxChars = names.reduce((m, n) => Math.max(m, short(n).length), 1);
    colWidth[c] = boxWidthFor(maxChars);
  }
  if (hasGhosts) {
    const maxChars = ghostLabels.reduce((m, l) => Math.max(m, l.length), 1);
    colWidth[ghostCol] = boxWidthFor(maxChars);
  }

  // Cumulative x for each column.
  const colX: number[] = [];
  let x = PAD_X;
  for (let c = 0; c <= lastCol; c += 1) {
    colX[c] = x;
    x += (colWidth[c] ?? MIN_BOX) + COL_GAP;
  }

  const placed = new Map<string, Placed>();
  let maxRows = 1;
  for (const [c, names] of byCol) {
    names.sort();
    maxRows = Math.max(maxRows, names.length);
    names.forEach((name, row) => {
      const w = colWidth[c] ?? MIN_BOX;
      placed.set(name, { name, label: fitLabel(short(name), w), x: colX[c]!, y: TOP + row * (BOX_H + ROW_GAP), w, col: c });
    });
  }

  const ghosts = new Map<string, Ghost>();
  if (hasGhosts) {
    const w = colWidth[ghostCol] ?? MIN_BOX;
    maxRows = Math.max(maxRows, ghostLabels.length);
    ghostLabels.forEach((label, row) => {
      ghosts.set(label, { label: fitLabel(label, w), x: colX[ghostCol]!, y: TOP + row * (BOX_H + ROW_GAP), w });
    });
  }

  const lastW = colWidth[lastCol] ?? MIN_BOX;
  const width = (colX[lastCol] ?? PAD_X) + lastW + PAD_X;
  const height = TOP + maxRows * (BOX_H + ROW_GAP) + 10;
  const usedCols = [...byCol.keys()].sort((a, b) => a - b);
  return { placed, ghosts, usedCols, colX, width, height };
}

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

function meshSvg(graph: ServiceGraph): string {
  const { placed, ghosts, usedCols, colX, width, height } = layout(graph);
  const cy = (p: { y: number }): number => p.y + BOX_H / 2;

  // A service is "linked" if any call edge (resolved or dangling) touches it. A node
  // with none is a shared library or an event-only service — real, but with no
  // cross-service CALL to draw. We mute it (and the legend says why) rather than drop
  // it (hiding a real boundary) or draw a phantom edge.
  const linked = new Set<string>();
  for (const e of graph.edges) {
    linked.add(e.from);
    linked.add(e.to);
  }
  for (const d of graph.dangling) linked.add(d.service);

  // Natural pixel size (width/height attrs) so the container can scroll a big mesh at
  // a legible size instead of the viewBox stretching it to the card width.
  const parts: string[] = [
    `<svg class="mesh" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Service mesh — who calls whom, calls flow left to right.">`,
    `<defs>` +
      `<marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10z" fill="var(--slate)"/></marker>` +
      `<filter id="sf" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.5" stdDeviation="4" flood-color="oklch(40% 0.03 262)" flood-opacity="0.09"/></filter>` +
      `</defs>`
  ];

  for (const c of usedCols) {
    parts.push(`<text class="col-cap" x="${colX[c]}" y="26">${columnCaption(c)}</text>`);
  }
  // The dashed ghost column (unresolved/external boundaries) keeps its own caption.
  if (ghosts.size > 0) {
    const gx = [...ghosts.values()][0]!.x;
    parts.push(`<text class="col-cap" x="${gx}" y="26">UNRESOLVED</text>`);
  }

  // Real edges, calm slate. Draw from the right edge of `from` to left of `to`.
  parts.push(`<g fill="none" stroke="var(--slate)" stroke-width="1.2" opacity="0.45">`);
  for (const edge of graph.edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    parts.push(`<path d="${curve(from.x + from.w, cy(from), to.x, cy(to))}" marker-end="url(#ar)"/>`);
  }
  parts.push(`</g>`);

  // Dangling edges, dashed (unresolved / external).
  if (ghosts.size > 0) {
    parts.push(`<g fill="none" stroke="var(--slate)" stroke-width="1.2" stroke-dasharray="6 5" opacity="0.55">`);
    for (const d of graph.dangling) {
      const from = placed.get(d.service);
      const ghost = ghosts.get(d.contract);
      if (!from || !ghost) continue;
      parts.push(`<path d="${curve(from.x + from.w, cy(from), ghost.x, cy(ghost))}" marker-end="url(#ar)"/>`);
    }
    parts.push(`</g>`);
  }

  for (const p of placed.values()) {
    const color = TIER_COLORS[p.col % TIER_COLORS.length]!;
    const solo = !linked.has(p.name);
    // Unlinked node: muted group, hollow dot — distinct from a connected service.
    const dot = solo
      ? `<circle cx="${p.x + 18}" cy="${p.y + BOX_H / 2}" r="4" fill="none" stroke="${color}" stroke-width="1.5"/>`
      : `<circle cx="${p.x + 18}" cy="${p.y + BOX_H / 2}" r="4" fill="${color}"/>`;
    parts.push(
      `<g${solo ? ' opacity="0.62"' : ""}><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${BOX_H}" rx="10" fill="var(--card)" stroke="var(--line)" filter="url(#sf)"/>` +
        dot +
        `<text class="nlabel" x="${p.x + TEXT_X}" y="${p.y + BOX_H / 2 + 4}">${escape(p.label)}</text></g>`
    );
  }

  for (const g of ghosts.values()) {
    parts.push(
      `<g><rect x="${g.x}" y="${g.y}" width="${g.w}" height="${BOX_H + 6}" rx="10" fill="var(--slate-soft)" stroke="var(--slate)" stroke-opacity="0.55" stroke-dasharray="6 5" filter="url(#sf)"/>` +
        `<circle cx="${g.x + 18}" cy="${g.y + (BOX_H + 6) / 2 - 6}" r="4" fill="none" stroke="var(--slate)" stroke-width="1.6"/>` +
        `<text class="nlabel" x="${g.x + TEXT_X}" y="${g.y + (BOX_H + 6) / 2 - 2}" fill="var(--slate)">${escape(g.label)}</text>` +
        `<text x="${g.x + TEXT_X}" y="${g.y + (BOX_H + 6) / 2 + 11}" font-family="var(--mono)" font-size="9.5" fill="var(--slate)" opacity="0.85">unresolved</text></g>`
    );
  }

  parts.push(`</svg>`);
  return parts.join("");
}

// ---- capability cards --------------------------------------------------------------

export function capCard(cap: Capability, index: number): string {
  const color = TIER_COLORS[index % TIER_COLORS.length]!;
  const conf =
    cap.confidence === "medium"
      ? `<span class="conf" title="lower-confidence grouping">medium confidence</span>`
      : "";
  return (
    `<div class="cap"><div class="ct"><span class="dot" style="background:${color}"></span>` +
    `<h2>${escape(cap.name)}</h2>${conf}</div>` +
    `<p>${escape(cap.summary)}</p>` +
    `<span class="via">${escape(viaLine(cap))}</span></div>`
  );
}

// ---- studio content (reused by the standalone page and the app's Studio tab) -------

export const STUDIO_CSS = `.hdr{padding:24px 28px; display:flex; align-items:flex-start; gap:24px; flex-wrap:wrap}
.hdr-main{flex:1; min-width:340px}
.eyebrow{font-size:11px; font-weight:650; letter-spacing:0.09em; color:var(--faint); margin-bottom:11px}
h1{font-size:25px; line-height:1.2; font-weight:700; letter-spacing:-0.02em; margin-bottom:8px}
.meta{font-family:var(--mono); font-size:12.5px; color:var(--dim)}
.badge{display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--green); background:var(--green-soft); border-radius:999px; padding:6px 13px}
.badge svg{width:14px; height:14px; stroke:currentColor; fill:none; stroke-width:1.7}
.sect{padding:20px 24px 22px}
.sect-head{display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:8px; flex-wrap:wrap}
.legend{display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--dim)}
.legend span{display:inline-flex; align-items:center; gap:7px}
.legend i{width:9px; height:9px; border-radius:50%; display:inline-block; font-style:normal}
.legend .ext{width:14px; height:0; border-top:2px dashed var(--slate); border-radius:0}
.legend .solo{background:transparent; border:1.5px solid var(--faint)}
.meshwrap{overflow:auto; max-height:540px; margin-top:6px; border:1px solid var(--line-soft); border-radius:10px}
.mesh{display:block; margin:12px 16px}
.mesh text{font-family:var(--mono)}
.col-cap{font-size:10.5px; letter-spacing:0.1em; font-weight:700; fill:var(--faint)}
.nlabel{font-family:var(--mono); font-size:12.5px; fill:var(--ink)}
.empty{font-size:13px; color:var(--faint); padding:14px 4px}
.caps{padding:4px 0 0}
.caps-head{padding:0 24px; display:flex; align-items:baseline; gap:12px; margin-bottom:14px}
.caps-grid{display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:0 24px 22px}
@media (max-width:1080px){.caps-grid{grid-template-columns:repeat(2,1fr)}}
@media (max-width:760px){.hdr-main{min-width:0}}
@media (max-width:560px){.caps-grid{grid-template-columns:1fr}}
.cap{border:1px solid var(--line); border-radius:12px; padding:15px 16px; display:flex; flex-direction:column; gap:8px; background:var(--card)}
.cap .ct{display:flex; align-items:center; gap:9px; flex-wrap:wrap}
.cap .dot{width:9px; height:9px; border-radius:50%; flex:none}
.cap h2{font-size:14.5px; font-weight:650}
.cap .conf{font-size:10px; font-weight:600; color:var(--faint); background:var(--line-soft); border-radius:6px; padding:2px 7px; letter-spacing:0.02em}
.cap p{font-size:12.5px; line-height:1.5; color:var(--dim); text-wrap:pretty; flex:1}
.cap .via{font-family:var(--mono); font-size:10.5px; color:var(--faint); padding-top:8px; border-top:1px solid var(--line-soft)}
.unknowns{padding:20px 24px 22px}
.unknowns ul{list-style:none; display:flex; flex-direction:column; gap:9px; margin-top:12px}
.unknowns li{font-size:12.5px; line-height:1.5; color:var(--dim); display:flex; gap:10px; align-items:flex-start}
.unknowns li::before{content:""; width:7px; height:7px; border-radius:50%; background:var(--faint); flex:none; margin-top:6px}
.footrail{display:flex; align-items:center; gap:13px; flex-wrap:wrap; padding:14px 24px; background:var(--card); border:1px solid var(--line); border-radius:var(--r); box-shadow:var(--shadow-sm)}
.grounded{display:inline-flex; align-items:center; gap:8px; font-size:12.5px; font-weight:600; color:var(--green)}
.grounded svg{width:15px; height:15px; stroke:var(--green); fill:none; stroke-width:1.7}
.footrail .ft-note{font-size:12.5px; color:var(--dim)}
.footrail .spacer{flex:1}
.hbit{font-size:12px; font-weight:550; color:var(--dim); background:var(--line-soft); border-radius:8px; padding:5px 11px; display:inline-flex; align-items:center; gap:7px}
.hbit.ext{color:var(--slate)}`;

function metaLine(architecture: ServiceGraph, baseline: Baseline): string {
  const externalCount = new Set(architecture.dangling.map((d) => d.contract)).size;
  const serviceCount = architecture.services.length;
  const capCount = baseline.capabilities.length;
  return (
    `${serviceCount} service${serviceCount === 1 ? "" : "s"} · ` +
    `${externalCount} external · ` +
    `${capCount} ${capCount === 1 ? "capability" : "capabilities"}`
  );
}

// The Studio header + mesh section (the "what the system is" picture).
export function studioPicture(title: string, baseline: Baseline, architecture: ServiceGraph): string {
  const hasMesh = architecture.services.length > 0 || architecture.edges.length > 0 || architecture.dangling.length > 0;
  const mesh = hasMesh
    ? `<div class="meshwrap">${meshSvg(architecture)}</div>`
    : `<div class="empty">No services detected — this workspace has no cross-service calls to map yet.</div>`;
  // Show the "no cross-service calls" legend only when such a node is actually drawn.
  const linked = new Set<string>();
  for (const e of architecture.edges) {
    linked.add(e.from);
    linked.add(e.to);
  }
  for (const d of architecture.dangling) linked.add(d.service);
  const hasSolo = architecture.services.some((s) => !linked.has(s));
  const soloLegend = hasSolo ? `<span><i class="solo"></i>no cross-service calls (shared lib / event-only)</span>` : "";
  return (
    `<div class="card hdr">
        <div class="hdr-main">
          <div class="eyebrow">WHAT THE SYSTEM IS</div>
          <h1>${escape(title)}</h1>
          <div class="meta">${escape(metaLine(architecture, baseline))}</div>
        </div>
        <span class="badge"><svg><use href="#i-shield"></use></svg>Grounded · Leashed</span>
      </div>
      <div class="card sect">
        <div class="sect-head">
          <span class="sect-title">ARCHITECTURE &amp; FLOW · column = call depth (entry on the left)</span>
          <div class="legend">
            ${soloLegend}<span><i class="ext"></i>unresolved</span>
          </div>
        </div>
        ${mesh}
      </div>`
  );
}

function footrail(baseline: Baseline, architecture: ServiceGraph): string {
  const externalCount = new Set(architecture.dangling.map((d) => d.contract)).size;
  const externalNote =
    externalCount > 0
      ? `<span class="hbit ext">${externalCount} unresolved external ${externalCount === 1 ? "dependency" : "dependencies"}</span>`
      : "";
  return `<div class="footrail">
        <span class="grounded"><svg><use href="#i-shield"></use></svg>Grounded · Leashed</span>
        <span class="ft-note">Every node, edge, and capability is backed by file:line — the standing picture the shift card diffs against.</span>
        <span class="spacer"></span>
        ${externalNote}
        <span class="hbit">${escape(baseline.derivedFrom.factsHash.slice(0, 12))}</span>
        ${feedbackLink()}
      </div>`;
}

// The full Studio content (inside `.content`): picture + compact capabilities +
// unknowns + footer. Reused by the standalone page and the app's Studio tab.
export function studioContent(title: string, baseline: Baseline, architecture: ServiceGraph): string {
  const caps = baseline.capabilities.map((cap, i) => capCard(cap, i)).join("");
  const unknowns = baseline.unknowns.map((u) => `<li>${escape(u.note)}</li>`).join("");
  // Honest fit note when there's nothing to ground: empty capabilities AND almost no
  // services actually connected (a couple coarse edges among many) means this isn't the
  // shape Mappamind illuminates — a single in-process codebase or a monorepo of tooling
  // and independent units. Say so plainly rather than present an empty grid next to a
  // list of mis-detected "services". A real mesh whose synthesis merely came back empty
  // (most services connected) gets the softer note instead, not this claim.
  const linkedServices = new Set<string>();
  for (const e of architecture.edges) {
    linkedServices.add(e.from);
    linkedServices.add(e.to);
  }
  for (const d of architecture.dangling) linkedServices.add(d.service);
  const connectedRatio = architecture.services.length ? linkedServices.size / architecture.services.length : 0;
  const lowValue = baseline.capabilities.length === 0 && connectedRatio < 0.3;
  const capsBody = lowValue
    ? `<div class="empty">No capabilities derived, and almost nothing here calls anything else. Mappamind works best on a <b>service architecture</b> — multiple services that call each other (microservices, or a frontend talking to a backend). A single in-process codebase, or a monorepo of build tools and independent units, won't yield a useful picture here.</div>`
    : baseline.capabilities.length === 0
      ? `<div class="empty">No capabilities derived for this baseline.</div>`
      : `<div class="caps-grid">${caps}</div>`;
  return (
    studioPicture(title, baseline, architecture) +
    `<div class="card caps">
        <div class="caps-head"><span class="sect-title">BEHAVIOR · EVERY CAPABILITY, WHAT IT DOES</span></div>
        ${capsBody}
      </div>` +
    (unknowns ? `<div class="card unknowns"><span class="sect-title">UNKNOWNS · FLAGGED, NOT GUESSED</span><ul>${unknowns}</ul></div>` : "") +
    footrail(baseline, architecture)
  );
}

// Standalone Studio page (CLI `baseline`, back-compat). Same shell as the app.
export function renderStudioHtml(title: string, baseline: Baseline, architecture: ServiceGraph): string {
  const navHtml = [
    navItem({ icon: "i-shift", label: "Shifts", href: "#" }),
    navItem({ icon: "i-service", label: "Studio", href: "#", active: true }),
    navItem({ icon: "i-grid", label: "Capabilities", href: "#" }),
    navItem({ icon: "i-contract", label: "Contracts", href: "#" })
  ].join("");
  return renderShell({
    title: `${title} · Studio — mappamind`,
    crumb: `<b>Studio</b><span class="sep">/</span>${escape(title)}`,
    navHtml,
    headExtra: STUDIO_CSS,
    content: `<div class="content">${studioContent(title, baseline, architecture)}</div>`
  });
}
