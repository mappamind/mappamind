// The Mappamind app: one self-contained page per workspace, four tabs, no server.
//
// Studio | Shifts | Capabilities | Contracts — switched with CSS-only radio tabs
// (the same `:has()` mechanism as the dark toggle), so the page stays offline and
// script-free. Every tab reads grounded data: capabilities from the baseline,
// the mesh + contracts recomputed deterministically, shift history from the
// ledger. The standalone Studio page and the archived shift cards share this same
// shell, so the whole product reads as one surface.

import type { Baseline } from "@mappamind_/baseline";
import type { Channel, SeamContract, SeamReport, ServiceGraph } from "@mappamind_/seam";

import { renderShell, escape, navItem, short } from "./theme.js";
import { STUDIO_CSS, studioContent } from "./render.js";

// One row of the shift ledger (shifts.jsonl), enough to list session history.
export type ShiftHistoryEntry = {
  readonly at: string;
  readonly severity: string;
  readonly title: string;
  readonly changedFiles: number;
  readonly affectedFiles: number;
  readonly brokenContracts: number;
  readonly cardFile?: string; // filename under .mappamind/shift/, for the link
};

export type RenderAppInput = {
  readonly title: string;
  readonly baseline: Baseline;
  readonly architecture: ServiceGraph;
  readonly seams: SeamReport;
  // The verified cross-service channels behind the mesh — the Contracts tab's primary
  // rows (the legacy convention-based seam contracts ship empty now, §I1).
  readonly channels?: readonly Channel[];
  readonly history?: readonly ShiftHistoryEntry[];
};

const TABS = [
  { id: "tab-studio", icon: "i-service", label: "Studio", view: "view-studio" },
  { id: "tab-shifts", icon: "i-shift", label: "Shifts", view: "view-shifts" },
  { id: "tab-caps", icon: "i-grid", label: "Capabilities", view: "view-caps" },
  { id: "tab-contracts", icon: "i-contract", label: "Contracts", view: "view-contracts" }
] as const;

const APP_CSS = `${STUDIO_CSS}
.view{display:none}
${TABS.map((t) => `body:has(#${t.id}:checked) .${t.view}`).join(",\n")}{display:flex; flex-direction:column; gap:18px}
${TABS.map((t) => `body:has(#${t.id}:checked) label[for="${t.id}"]`).join(",\n")}{background:var(--blue); color:white; box-shadow:var(--shadow-sm)}
${TABS.map((t) => `body:has(#${t.id}:checked) label[for="${t.id}"] svg`).join(",\n")}{opacity:1}
.tabhead{padding:22px 26px 0}
.tabhead h1{font-size:21px; margin-bottom:4px}
.tabhead p{font-size:13px; color:var(--dim)}
.capx{padding:18px 20px}
.capx .ct{display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin-bottom:7px}
.capx .dot{width:9px; height:9px; border-radius:50%; flex:none}
.capx h2{font-size:16px; font-weight:660}
.capx .tag{font-size:10px; font-weight:600; color:var(--faint); background:var(--line-soft); border-radius:6px; padding:2px 7px; letter-spacing:0.02em}
.capx p{font-size:13.5px; line-height:1.55; color:var(--dim); margin-bottom:12px; text-wrap:pretty}
.cites{list-style:none; display:flex; flex-direction:column; gap:5px; border-top:1px solid var(--line-soft); padding-top:11px}
.cites li{font-family:var(--mono); font-size:11.5px; color:var(--faint); display:flex; flex-wrap:wrap; gap:8px; overflow-wrap:anywhere; min-width:0}
.cites li b{color:var(--dim); font-weight:600}
.tblwrap{overflow-x:auto; max-width:100%}
.tbl{width:100%; border-collapse:collapse; font-size:12.5px}
.tbl th{text-align:left; font-size:10.5px; letter-spacing:0.08em; font-weight:650; color:var(--faint); padding:8px 14px; border-bottom:1px solid var(--line)}
.tbl td{padding:10px 14px; border-bottom:1px solid var(--line-soft); color:var(--dim); vertical-align:top}
.tbl td.k{font-family:var(--mono); color:var(--ink); font-weight:600}
.tbl td.loc{font-family:var(--mono); font-size:11.5px}
.st{font-size:11px; font-weight:650; border-radius:999px; padding:3px 10px; display:inline-block}
.st.in_sync,.st.verified{color:var(--green); background:var(--green-soft)}
.st.dangling{color:var(--red); background:var(--red-soft)}
.st.orphan{color:var(--amber); background:var(--amber-soft)}
.st.external{color:var(--slate); background:var(--slate-soft)}
.st-note{display:block; margin-top:4px; font-size:10px; font-weight:500; color:var(--faint); letter-spacing:0.02em}
.shifts{list-style:none; display:flex; flex-direction:column; gap:0}
.shiftrow{display:flex; align-items:center; gap:14px; padding:14px 20px; border-bottom:1px solid var(--line-soft); text-decoration:none; color:inherit}
.shiftrow:last-child{border-bottom:none}
.shiftrow:hover{background:var(--line-soft)}
.shiftrow .sev{font-size:10px; font-weight:700; letter-spacing:0.06em; color:white; border-radius:6px; padding:3px 8px; flex:none; min-width:62px; text-align:center}
.sev.broad{background:var(--amber); color:oklch(22% 0.02 70)} .sev.local{background:var(--blue)} .sev.cosmetic{background:var(--faint)}
.shiftrow .st-body{display:flex; flex-direction:column; min-width:0}
.shiftrow .st-title{font-weight:600; color:var(--ink); font-size:13.5px}
.shiftrow .st-meta{font-family:var(--mono); font-size:11.5px; color:var(--faint); margin-top:2px}
.shiftrow .when{margin-left:auto; font-family:var(--mono); font-size:11.5px; color:var(--faint); flex:none}
.empty{font-size:13px; color:var(--faint); padding:22px 26px}`;

function tabHead(title: string, sub: string): string {
  return `<div class="tabhead"><h1>${escape(title)}</h1><p>${escape(sub)}</p></div>`;
}

// ---- Capabilities tab: expanded cards with file:line citations ---------------------

function capabilitiesView(baseline: Baseline): string {
  if (baseline.capabilities.length === 0) {
    return tabHead("Capabilities", "What the system does.") + `<div class="card"><div class="empty">No capabilities derived yet — run the baseline.</div></div>`;
  }
  const cards = baseline.capabilities
    .map((cap) => {
      const cites = cap.members
        .slice(0, 12)
        .map((m) => `<li><b>${escape(m.repo)}</b>${escape(m.file)}${m.line ? `:${m.line}` : ""}${m.symbol ? ` · ${escape(m.symbol)}` : ""}</li>`)
        .join("");
      const more = cap.members.length > 12 ? `<li>+${cap.members.length - 12} more</li>` : "";
      const tag = `<span class="tag">${escape(cap.provenance)} · ${escape(cap.confidence)}</span>`;
      return (
        `<div class="card capx"><div class="ct"><span class="dot" style="background:var(--blue)"></span><h2>${escape(cap.name)}</h2>${tag}</div>` +
        `<p>${escape(cap.summary)}</p>` +
        `<ul class="cites">${cites}${more}</ul></div>`
      );
    })
    .join("");
  return tabHead("Capabilities", `${baseline.capabilities.length} grounded — every member is a real file:line.`) + cards;
}

// ---- Contracts tab: seam contracts + unresolved external calls ---------------------

function contractRow(contract: SeamContract): string {
  const def = contract.definitions[0];
  const defLoc = def ? `${def.file}:${def.line}` : contract.references[0] ? `${contract.references[0]!.file}:${contract.references[0]!.line}` : "—";
  return (
    `<tr><td class="k">${escape(contract.key)}</td>` +
    `<td><span class="st ${contract.status}">${escape(contract.status.replace("_", " "))}</span></td>` +
    `<td>${escape(contract.seamType ?? contract.confidence)}</td>` +
    `<td class="loc">${escape(defLoc)}</td>` +
    `<td>${contract.references.length}</td></tr>`
  );
}

// A verified channel as a contract row: its key, the producer's cited file:line, and
// how many consumers call it. These are the real cross-service edges from the channel
// pipeline — the table's primary value now that conventions ship empty. The status
// mirrors the shift card's honesty (§I3): the anchors are verified (re-found in code),
// but the producer↔consumer RELATION is model-inferred — labelled, never presented as
// the same certainty as the existence proof.
function channelRow(channel: Channel): string {
  const producers = channel.memberships.filter((m) => m.role === "produce" || m.role === "both");
  const consumers = channel.memberships.filter((m) => m.role === "consume" || m.role === "both");
  const anchor = (producers[0] ?? channel.memberships[0])?.anchor;
  const loc = anchor ? `${anchor.file}:${anchor.line}` : "—";
  return (
    `<tr><td class="k">${escape(channel.key)}</td>` +
    `<td><span class="st verified">anchors verified</span><span class="st-note">relation inferred</span></td>` +
    `<td>${escape(channel.kind)}</td>` +
    `<td class="loc">${escape(loc)}</td>` +
    `<td>${Math.max(1, consumers.length)}</td></tr>`
  );
}

function contractsView(seams: SeamReport, architecture: ServiceGraph, channels: readonly Channel[]): string {
  const channelRows = [...channels].sort((a, b) => a.key.localeCompare(b.key)).map(channelRow).join("");
  const contracts = [...seams.contracts].sort((a, b) => a.key.localeCompare(b.key));
  const externalRows = architecture.dangling
    .map(
      (d) =>
        `<tr><td class="k">${escape(short(d.service))} → ${escape(d.contract)}</td>` +
        `<td><span class="st external">external</span></td><td>service call</td>` +
        `<td class="loc">${escape(d.file)}:${d.line}</td><td>1</td></tr>`
    )
    .join("");
  const total = channels.length + contracts.length + architecture.dangling.length;
  if (total === 0) {
    return tabHead("Contracts", "Named edges across boundaries.") + `<div class="card"><div class="empty">No cross-boundary contracts detected in this workspace.</div></div>`;
  }
  const rows = channelRows + contracts.map(contractRow).join("") + externalRows;
  return (
    tabHead("Contracts", `${total} cross-boundary contract${total === 1 ? "" : "s"} · channels + external calls, recomputed from the current code.`) +
    `<div class="card"><div class="tblwrap"><table class="tbl"><thead><tr><th>Contract</th><th>Status</th><th>Type</th><th>Defined / called at</th><th>Refs</th></tr></thead><tbody>${rows}</tbody></table></div></div>`
  );
}

// ---- Shifts tab: session history from the ledger -----------------------------------

function shiftsView(history: readonly ShiftHistoryEntry[]): string {
  if (history.length === 0) {
    return (
      tabHead("Shifts", "What each AI session changed.") +
      `<div class="card"><div class="empty">No sessions recorded yet. End an agent session (the Stop hook) to see the first shift here.</div></div>`
    );
  }
  const rows = [...history]
    .reverse()
    .map((h) => {
      const sev = (h.severity || "local").toLowerCase();
      const meta = `${h.changedFiles} changed · ${h.affectedFiles} affected${h.brokenContracts > 0 ? ` · ${h.brokenContracts} broken` : ""}`;
      const inner =
        `<span class="sev ${sev}">${escape((h.severity || "local").toUpperCase())}</span>` +
        `<span class="st-body"><span class="st-title">${escape(h.title)}</span><span class="st-meta">${escape(meta)}</span></span>` +
        `<span class="when">${escape(h.at.replace("T", " ").slice(0, 16))}</span>`;
      return h.cardFile
        ? `<a class="shiftrow" href="shift/${escape(h.cardFile)}">${inner}</a>`
        : `<div class="shiftrow">${inner}</div>`;
    })
    .join("");
  return tabHead("Shifts", `${history.length} session${history.length === 1 ? "" : "s"} recorded.`) + `<div class="card"><div class="shifts">${rows}</div></div>`;
}

// ---- the page ----------------------------------------------------------------------

export function renderAppHtml(input: RenderAppInput): string {
  const { title, baseline, architecture, seams } = input;
  const channels = input.channels ?? [];
  const history = input.history ?? [];

  const preBody = TABS.map((t, i) => `<input class="mm-tab" type="radio" name="mm-tab" id="${t.id}"${i === 0 ? " checked" : ""} aria-hidden="true" tabindex="-1">`).join("\n");
  const navHtml = TABS.map((t) => navItem({ icon: t.icon, label: t.label, forId: t.id })).join("");

  const content =
    `<div class="content">` +
    `<section class="view view-studio">${studioContent(title, baseline, architecture)}</section>` +
    `<section class="view view-shifts">${shiftsView(history)}</section>` +
    `<section class="view view-caps">${capabilitiesView(baseline)}</section>` +
    `<section class="view view-contracts">${contractsView(seams, architecture, channels)}</section>` +
    `</div>`;

  return renderShell({
    title: `${title} · Studio — mappamind`,
    crumb: `<b>Studio</b><span class="sep">/</span>${escape(title)}`,
    navHtml,
    headExtra: APP_CSS,
    preBody,
    content
  });
}
