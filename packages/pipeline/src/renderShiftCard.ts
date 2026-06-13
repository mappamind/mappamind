// renderShiftCard: the before/after picture — THE product (see docs/ARCHITECTURE.md).
//
// One self-contained HTML card, rendered at the accept moment. The visual
// system is the design track's mockups, implemented
// as three systematic primitives chosen by data shape, never per-scenario art:
//   flow-diff    — the mesh changed (broken contracts, lost/added services)
//   depth-bands  — file-grain ripple, ≤ 50 dependents
//   rollup-stats — file-grain ripple past 50 (the number is the message)
//
// Grammar rules carried from the severity spec:
//   - The red tag is EARNED only by an alarming break (internal/unknown
//     dangling). Advisory breadth wears amber BROAD · ADVISORY. External-SDK
//     adoption is blue, informational by rule.
//   - Sans speaks, mono cites: monospace is reserved for repo facts.
//   - Every bound on a list surfaces as "+N more" — no silent caps.
//   - Dark by default (terminal-adjacent); printing flips to light.
//   - Deterministic: same data → same markup, byte for byte.

import type { BrokenContract, ChannelChange, ImpactSlice, MeshDiff, ShiftCard } from "@mappamind_/impact";

import { feedbackLink, navItem, renderShell } from "./theme.js";

export type RenderShiftInput = {
  readonly card: ShiftCard;
  readonly slice: ImpactSlice;
  readonly diff?: MeshDiff;
  // Services untouched by the session (for honest scale). Optional — the 2d
  // runner passes the after-mesh services minus the slice.
  readonly contextServices?: readonly string[];
  readonly repoName?: string;
};

const MAX_BAND_EXEMPLARS = 3;
const MAX_BANDS = 6;
const MAX_BEHAVIOR_CHIPS = 6;
const MAX_CONTEXT_CHIPS = 8;
const MAX_EVIDENCE_PER_KIND = 4;
const MAX_DIRECT_IMPORTERS = 5;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shortService(service: string): string {
  return service.replace(/^(src|services|service|apps|app|packages|internal|lib)\//, "");
}

// Mirror of the seam's contract-key normalization, so a removed service can be
// matched to the contract its consumers dangle on ("src/shippingservice" → "shipping").
function keyOf(raw: string): string {
  const last = raw.split("/").filter(Boolean).pop() ?? raw;
  return last
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/service$/, "")
    .replace(/s$/, "");
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

// ---- the severity tag ------------------------------------------------------------

type SeverityView = { readonly label: string; readonly cls: string; readonly detail: string };

function severityView(card: ShiftCard, slice: ImpactSlice, diff?: MeshDiff): SeverityView {
  const alarming = card.brokenContracts.filter((broken) => broken.kind !== "external-service");
  const external = card.brokenContracts.filter((broken) => broken.kind === "external-service");

  const detail: string[] = [];
  detail.push(plural(alarming.length, "contract") + " broken");
  if (diff && diff.removedServices.length > 0) detail.push(plural(diff.removedServices.length, "service") + " removed");
  if (diff && diff.addedServices.length > 0) detail.push(`${diff.addedServices.length} added`);
  if (external.length > 0) detail.push(`${external.length} new external ${external.length === 1 ? "dependency" : "dependencies"}`);
  if (alarming.length === 0 && slice.atRiskServiceEdges.length > 0) {
    const consumers = new Set(slice.atRiskServiceEdges.map((edge) => edge.consumer));
    detail.push(plural(consumers.size, "consumer") + " at risk");
  }
  if (slice.affectedFiles.length > 0) detail.push(`${slice.affectedFiles.length} files within reach`);

  if (card.severity === "cosmetic") {
    return { label: "COSMETIC", cls: "sev-dim", detail: "nothing downstream" };
  }
  if (alarming.length > 0) {
    return { label: card.severity.toUpperCase(), cls: "sev-red", detail: detail.join(" · ") };
  }
  if (card.severity === "broad") {
    return { label: "BROAD · ADVISORY", cls: "sev-amber", detail: detail.join(" · ") };
  }
  // local, nothing alarming: a pure external adoption is informational blue.
  if (external.length > 0) {
    return { label: "LOCAL", cls: "sev-blue", detail: `informational · ${detail.join(" · ")}` };
  }
  return { label: "LOCAL", cls: "sev-amber", detail: detail.join(" · ") };
}

// ---- the picture: flow-diff ------------------------------------------------------

type FlowNode = {
  readonly name: string;
  readonly status: string;
  readonly tone: "ink" | "red" | "amber" | "green" | "blue";
  readonly ghost: boolean; // dashed outline (removed / external / no-provider)
};

type FlowEdge = {
  readonly from: number; // index into left column
  readonly to: number; // index into right column
  readonly tone: "red" | "amber" | "green" | "blue";
  readonly dashed: boolean;
  readonly label: string; // mono fact (file:line or contract)
};

const TONE = {
  ink: { stroke: "var(--line)", text: "var(--ink)" },
  red: { stroke: "var(--red)", text: "var(--red)" },
  amber: { stroke: "var(--amber)", text: "var(--amber)" },
  green: { stroke: "var(--green)", text: "var(--green)" },
  blue: { stroke: "var(--blue)", text: "var(--blue)" }
} as const;

function buildFlow(card: ShiftCard, slice: ImpactSlice, diff?: MeshDiff): { left: FlowNode[]; right: FlowNode[]; edges: FlowEdge[] } {
  const left: FlowNode[] = [];
  const leftIndex = new Map<string, number>();
  const right: FlowNode[] = [];
  const rightIndex = new Map<string, number>();
  const edges: FlowEdge[] = [];

  const consumerStatus = new Map<string, { status: string; tone: FlowNode["tone"] }>();
  for (const broken of card.brokenContracts) {
    const tone = broken.kind === "external-service" ? "blue" : "red";
    const status =
      broken.kind === "internal-break"
        ? "Calls removed provider"
        : broken.kind === "external-service"
          ? "Calls external service"
          : "Calls missing provider";
    // an alarming status wins over an informational one
    const existing = consumerStatus.get(broken.service);
    if (!existing || existing.tone !== "red") consumerStatus.set(broken.service, { status, tone });
  }
  for (const edge of slice.atRiskServiceEdges) {
    if (!consumerStatus.has(edge.consumer)) {
      consumerStatus.set(edge.consumer, { status: "Calls changed provider", tone: "amber" });
    }
  }

  const leftOf = (service: string): number => {
    const found = leftIndex.get(service);
    if (found !== undefined) return found;
    const view = consumerStatus.get(service) ?? { status: "", tone: "ink" as const };
    left.push({ name: shortService(service), status: view.status, tone: view.tone, ghost: false });
    leftIndex.set(service, left.length - 1);
    return left.length - 1;
  };

  const rightOf = (key: string, make: () => FlowNode): number => {
    const found = rightIndex.get(key);
    if (found !== undefined) return found;
    right.push(make());
    rightIndex.set(key, right.length - 1);
    return right.length - 1;
  };

  const removed = diff?.removedServices ?? [];
  const newEdges = diff?.newEdges ?? [];

  // Removed providers first: the hole the arrows point into.
  for (const service of removed) {
    rightOf(`svc:${service}`, () => ({ name: shortService(service), status: "Provider removed", tone: "red", ghost: true }));
  }

  for (const broken of card.brokenContracts) {
    const from = leftOf(broken.service);
    const removedMatch = removed.find((service) => keyOf(service) === broken.contract);
    const to = removedMatch
      ? rightIndex.get(`svc:${removedMatch}`)!
      : broken.kind === "external-service"
        ? rightOf(`ext:${broken.contract}`, () => ({ name: broken.contract, status: "External · outside this workspace", tone: "blue", ghost: true }))
        : rightOf(`gone:${broken.contract}`, () => ({ name: broken.contract, status: "No provider in workspace", tone: "red", ghost: true }));
    edges.push({
      from,
      to,
      tone: broken.kind === "external-service" ? "blue" : "red",
      dashed: true,
      label: `${broken.file.split("/").pop() ?? broken.file}:${broken.line}`
    });
  }

  // At-risk flow (provider changed, nothing proven broken): amber, solid.
  // A pair already proven broken is NOT also drawn at-risk — the break is the
  // stronger fact and a second line would only dilute it.
  for (const edge of slice.atRiskServiceEdges) {
    const broken = card.brokenContracts.some(
      (contract) => contract.service === edge.consumer && contract.contract === edge.contract
    );
    if (broken) continue;
    const from = leftOf(edge.consumer);
    const to = rightOf(`svc:${edge.provider}`, () => ({
      name: shortService(edge.provider),
      status: "Provider changed this session",
      tone: "amber",
      ghost: false
    }));
    edges.push({ from, to, tone: "amber", dashed: false, label: edge.contract });
  }

  // Added services close the picture (growth is noted, not celebrated).
  for (const service of diff?.addedServices ?? []) {
    const hasCallers = newEdges.some((edge) => edge.to === service);
    rightOf(`svc:${service}`, () => ({
      name: shortService(service),
      status: hasCallers ? "Added this session" : "Added · no callers yet",
      tone: "green",
      ghost: false
    }));
  }

  return { left, right, edges };
}

const FLOW = { leftX: 24, leftW: 250, rightX: 660, rightW: 300, nodeH: 64, gapY: 30, top: 18 };

type Flow = ReturnType<typeof buildFlow>;

function flowSvg(flow: Flow, ariaLabel: string): string {
  const { left, right, edges } = flow;
  const rows = Math.max(left.length, right.length, 1);
  const height = FLOW.top + rows * (FLOW.nodeH + FLOW.gapY);
  const width = FLOW.rightX + FLOW.rightW + 24;

  const nodeY = (index: number): number => FLOW.top + index * (FLOW.nodeH + FLOW.gapY);
  const parts: string[] = [
    `<svg class="flow" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(ariaLabel)}">`
  ];

  edges.forEach((edge, index) => {
    const x1 = FLOW.leftX + FLOW.leftW;
    const y1 = nodeY(edge.from) + FLOW.nodeH / 2;
    const x2 = FLOW.rightX;
    const y2 = nodeY(edge.to) + FLOW.nodeH / 2;
    const mx = (x1 + x2) / 2;
    const tone = TONE[edge.tone];
    // Each label sits at its own fraction along the curve so parallel edges
    // (and edges sharing endpoints) never overprint each other.
    const t = 0.3 + (index % 3) * 0.18;
    const u = 1 - t;
    const lx = u * u * u * x1 + 3 * u * u * t * mx + 3 * u * t * t * mx + t * t * t * x2;
    const ly = y1 * (u * u * u + 3 * u * u * t) + y2 * (3 * u * t * t + t * t * t);
    parts.push(
      `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 8},${y2}" fill="none" stroke="${tone.stroke}" stroke-width="2"${edge.dashed ? ' stroke-dasharray="7 6"' : ""}/>` +
        `<path d="M${x2 - 9},${y2 - 5} L${x2},${y2} L${x2 - 9},${y2 + 5} z" fill="${tone.stroke}"/>` +
        `<text class="elabel" x="${lx.toFixed(1)}" y="${(ly - 9).toFixed(1)}" text-anchor="middle" fill="${tone.text}">${escapeHtml(edge.label)}</text>`
    );
  });

  const node = (n: FlowNode, x: number, w: number, index: number): string => {
    const y = nodeY(index);
    const tone = TONE[n.tone];
    const stroke = n.tone === "ink" ? "var(--line)" : tone.stroke;
    const fill = n.tone === "ink" ? "var(--card2)" : `color-mix(in oklab, ${tone.stroke} 9%, var(--card2))`;
    return (
      `<rect x="${x}" y="${y}" width="${w}" height="${FLOW.nodeH}" rx="12" fill="${fill}" stroke="${stroke}" stroke-opacity="0.55"${n.ghost ? ' stroke-dasharray="7 6"' : ""}/>` +
      `<text class="nlabel" x="${x + 18}" y="${y + 27}" fill="${n.tone === "ink" ? "var(--ink)" : tone.text}">${escapeHtml(n.name)}</text>` +
      (n.status ? `<text class="nstatus" x="${x + 18}" y="${y + 47}" fill="${tone.text}">${escapeHtml(n.status)}</text>` : "")
    );
  };

  left.forEach((n, index) => parts.push(node(n, FLOW.leftX, FLOW.leftW, index)));
  right.forEach((n, index) => parts.push(node(n, FLOW.rightX, FLOW.rightW, index)));
  parts.push("</svg>");
  return parts.join("");
}

// Derived from the BUILT flow, so the legend never advertises a mark that the
// picture does not actually contain (e.g. an at-risk line deduped by a break).
function flowLegend(flow: Flow): string {
  const items: string[] = [];
  if (flow.edges.some((edge) => edge.tone === "red")) items.push(`<span><i class="ln red dash"></i>broken / removed</span>`);
  if (flow.edges.some((edge) => edge.tone === "blue")) items.push(`<span><i class="ln blue dash"></i>external dependency</span>`);
  if (flow.edges.some((edge) => edge.tone === "amber")) items.push(`<span><i class="ln amber"></i>at risk · provider changed</span>`);
  if (flow.right.some((node) => node.tone === "green")) items.push(`<span><i class="ln green dash"></i>added</span>`);
  return items.join("");
}

// ---- the picture: depth bands ----------------------------------------------------

function depthBands(slice: ImpactSlice): string {
  const byDepth = new Map<number, string[]>();
  for (const affected of slice.affectedFiles) {
    const bucket = byDepth.get(affected.depth) ?? [];
    bucket.push(affected.path);
    byDepth.set(affected.depth, bucket);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const shown = depths.slice(0, MAX_BANDS);
  const beyond = depths.slice(MAX_BANDS);

  const bands = shown.map((depth, index) => {
    const files = [...(byDepth.get(depth) ?? [])].sort();
    const exemplars = files.slice(0, MAX_BAND_EXEMPLARS).map(escapeHtml).join(" · ");
    const more = files.length - MAX_BAND_EXEMPLARS;
    return (
      `<div class="band" style="opacity:${Math.max(0.62, 1 - index * 0.09).toFixed(2)}">` +
      `<div class="bn"><b>${files.length}</b>depth ${depth}</div>` +
      `<div class="bf">${exemplars}${more > 0 ? ` <span class="mute">+${more} more</span>` : ""}</div></div>`
    );
  });
  if (beyond.length > 0) {
    const count = beyond.reduce((sum, depth) => sum + (byDepth.get(depth)?.length ?? 0), 0);
    bands.push(
      `<div class="band" style="opacity:0.6"><div class="bn"><b>${count}</b>depth ≥ ${beyond[0]}</div>` +
        `<div class="bf"><span class="mute">aggregated — deepest is ${depths[depths.length - 1]}</span></div></div>`
    );
  }

  const seeds = slice.changedPaths.map(escapeHtml).slice(0, 2).join(" · ");
  const direct = byDepth.get(1)?.length ?? 0;
  return (
    `<div class="ripple-src"><span class="src-pill">${seeds}${slice.changedPaths.length > 2 ? ` <span class="mute">+${slice.changedPaths.length - 2} more</span>` : ""}</span>` +
    `<span class="src-note">the edit · imported by ${direct} file${direct === 1 ? "" : "s"} directly</span></div>` +
    `<div class="bands">${bands.join("")}</div>`
  );
}

// ---- the picture: rollup stats ---------------------------------------------------

function rollup(slice: ImpactSlice): string {
  const total = slice.affectedFiles.length;
  const byDepth = new Map<number, number>();
  let maxDepth = 0;
  for (const affected of slice.affectedFiles) {
    byDepth.set(affected.depth, (byDepth.get(affected.depth) ?? 0) + 1);
    if (affected.depth > maxDepth) maxDepth = affected.depth;
  }
  const direct = [...slice.affectedFiles.filter((f) => f.depth === 1).map((f) => f.path)].sort();
  const reExportCarriers = [...(slice.reExportCarriers ?? [])].sort();
  const capabilityUnit =
    slice.affectedCapabilities.length === 1
      ? `capability · ${escapeHtml(slice.affectedCapabilities[0]!.name)}`
      : "capabilities touched";
  const reExportUnit =
    reExportCarriers.length === 1 ? "barrel re-export carries it" : "barrel re-exports carry it";

  const stats =
    `<div class="stat warn"><div class="num">${total}</div><div class="unit">files within reach</div></div>` +
    (reExportCarriers.length > 0
      ? `<div class="stat"><div class="num">${reExportCarriers.length}</div><div class="unit">${reExportUnit}</div></div>`
      : "") +
    `<div class="stat"><div class="num">${slice.affectedCapabilities.length}</div><div class="unit">${capabilityUnit}</div></div>` +
    `<div class="stat"><div class="num">${direct.length}</div><div class="unit">direct importers</div></div>` +
    `<div class="stat"><div class="num">${maxDepth}</div><div class="unit">imports deep at most</div></div>`;

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const maxCount = Math.max(...depths.map((d) => byDepth.get(d) ?? 0), 1);
  // One labeled row per depth: the depth, a bar sized against the LARGEST depth
  // (not the total), and the exact count inline. No separate key to cross-read and
  // no opacity gradient fighting the widths — the old stacked bar made the darkest
  // (shallowest) segment look biggest when it was usually the smallest.
  const rows = depths
    .map((depth) => {
      const count = byDepth.get(depth) ?? 0;
      const widthPct = Math.max(3, (count / maxCount) * 100);
      return (
        `<div class="distrow"><span class="dlabel">depth ${depth}</span>` +
        `<span class="dbar"><i style="width:${widthPct.toFixed(1)}%"></i></span>` +
        `<span class="dcount">${count}</span></div>`
      );
    })
    .join("");

  const listed = direct.slice(0, MAX_DIRECT_IMPORTERS);
  const entries = listed.map((path) => `<li>${escapeHtml(path)}</li>`).join("");
  const more = direct.length - listed.length;

  return (
    `<div class="stats">${stats}</div>` +
    `<div class="dist" role="img" aria-label="reach by import depth: ${depths.map((d) => `depth ${d}, ${byDepth.get(d)} files`).join("; ")}">${rows}</div>` +
    `<div class="entries"><span class="lbl">SURFACES TO CHECK · DIRECT IMPORTERS</span><ul>${entries}</ul>` +
    (more > 0 ? `<p class="fanout">+${more} more direct importers — full list in the session log.</p>` : "") +
    `</div>`
  );
}

// ---- evidence receipts -----------------------------------------------------------

type Receipt = { readonly tone: "red" | "amber" | "green" | "blue"; readonly loc: string; readonly fact: string };

function buildReceipts(card: ShiftCard, slice: ImpactSlice, diff?: MeshDiff): { receipts: Receipt[]; overflow: string[] } {
  const receipts: Receipt[] = [];
  const overflow: string[] = [];

  const broken = card.brokenContracts.filter((b) => b.kind !== "external-service");
  for (const contract of broken.slice(0, MAX_EVIDENCE_PER_KIND)) {
    receipts.push({
      tone: "red",
      loc: `${contract.file}:${contract.line}`,
      fact:
        contract.kind === "internal-break"
          ? `calls [${contract.contract}] — its provider was removed this session`
          : `calls [${contract.contract}] — no service in the workspace provides it`
    });
  }
  if (broken.length > MAX_EVIDENCE_PER_KIND) overflow.push(`+${broken.length - MAX_EVIDENCE_PER_KIND} more broken-contract call sites`);

  const external = card.brokenContracts.filter((b) => b.kind === "external-service");
  for (const contract of external.slice(0, MAX_EVIDENCE_PER_KIND)) {
    receipts.push({
      tone: "blue",
      loc: `${contract.file}:${contract.line}`,
      fact: `calls [${contract.contract}] — external service (${contract.kindSource === "model" ? "model-judged" : "proven"})`
    });
  }
  if (external.length > MAX_EVIDENCE_PER_KIND) overflow.push(`+${external.length - MAX_EVIDENCE_PER_KIND} more external-service call sites`);

  for (const contract of slice.atRiskContracts.slice(0, MAX_EVIDENCE_PER_KIND)) {
    const consumer = contract.consumers[0];
    if (!consumer) continue;
    receipts.push({
      tone: "amber",
      loc: `${consumer.file}:${consumer.line}`,
      fact: `consumes [${contract.key}], whose definition changed${contract.consumers.length > 1 ? ` (+${contract.consumers.length - 1} more consumers)` : ""}`
    });
  }
  if (slice.atRiskContracts.length > MAX_EVIDENCE_PER_KIND) overflow.push(`+${slice.atRiskContracts.length - MAX_EVIDENCE_PER_KIND} more at-risk contracts`);

  const direct = [...slice.affectedFiles.filter((f) => f.depth === 1).map((f) => f.path)].sort();
  for (const path of direct.slice(0, MAX_BAND_EXEMPLARS)) {
    receipts.push({ tone: "blue", loc: path, fact: "imports a changed file directly" });
  }
  if (direct.length > MAX_BAND_EXEMPLARS) overflow.push(`+${direct.length - MAX_BAND_EXEMPLARS} more direct importers`);

  const addedServices = diff?.addedServices ?? [];
  for (const service of addedServices.slice(0, MAX_EVIDENCE_PER_KIND)) {
    receipts.push({ tone: "green", loc: shortService(service), fact: "service added this session" });
  }
  if (addedServices.length > MAX_EVIDENCE_PER_KIND) overflow.push(`+${addedServices.length - MAX_EVIDENCE_PER_KIND} more added services`);

  return { receipts, overflow };
}

// ---- the hero: verified channel changes (diff-first, plan Phase 6) ---------------
//
// This is what the human reads first: every channel the session moved, each with
// its TWO cited lines rendered inline as the proof (§I3). Existence is verified
// (the anchors re-found this run → green pill); the relation/direction stays
// model-inferred and is labelled as such — never presented as the same certainty.

const CHANGE_LABEL = { added: "ADDED", removed: "REMOVED", changed: "CHANGED" } as const;
const ROLE_TONE = { produce: "green", consume: "blue", both: "amber", unknown: "amber" } as const;

function channelDescriptor(change: ChannelChange): string {
  const consumers = [...new Set(change.channel.memberships.filter((m) => m.role === "consume" || m.role === "both").map((m) => shortService(m.service)))];
  const producers = [...new Set(change.channel.memberships.filter((m) => m.role === "produce" || m.role === "both").map((m) => shortService(m.service)))];
  const arrow = consumers.length > 0 && producers.length > 0 ? `${consumers.join(", ")} → ${producers.join(", ")}` : [...consumers, ...producers].join(", ");
  return `${arrow} · ${change.channel.kind}`;
}

function renderChannelHero(changes: readonly ChannelChange[]): string {
  if (changes.length === 0) return "";
  const rows = changes
    .map((change) => {
      const tone = change.change === "removed" ? "red" : change.change === "added" ? "green" : "amber";
      const pill = change.verified
        ? `<span class="cpill ok">Verified · anchors re-found</span>`
        : `<span class="cpill gone">Not present after</span>`;
      const proof = change.channel.memberships
        .map((m) => {
          const roleTone = ROLE_TONE[m.role];
          return (
            `<div class="prow"><span class="prole ${roleTone}">${escapeHtml(m.role)}</span>` +
            `<span class="ploc">${escapeHtml(shortService(m.service))} · ${escapeHtml(m.anchor.file)}:${m.anchor.line}</span>` +
            `<span class="ptext">${escapeHtml(m.anchor.text)}</span></div>`
          );
        })
        .join("");
      const rationale = change.channel.rationale ? `<div class="cnarr">${escapeHtml(change.channel.rationale)}</div>` : "";
      return (
        `<div class="crow ${tone}">` +
        `<div class="chead"><span class="ctag ${tone}">${CHANGE_LABEL[change.change]}</span>` +
        `<span class="cdesc"><code>${escapeHtml(change.channel.key)}</code> · ${escapeHtml(channelDescriptor(change))}</span>` +
        `${pill}<span class="cpill inf">relation inferred</span></div>` +
        rationale +
        `<div class="proof">${proof}</div></div>`
      );
    })
    .join("");
  return (
    `<div class="card chero"><div class="pic-head"><span class="lbl">CHANNEL CHANGES · ${changes.length}</span>` +
    `<span class="sev-detail">the session's verified cross-service deltas — each line is cited proof</span></div>` +
    `<div class="crows">${rows}</div></div>`
  );
}

// ---- the card --------------------------------------------------------------------

export function renderShiftCardHtml(input: RenderShiftInput): string {
  const { card, slice, diff } = input;
  const severity = severityView(card, slice, diff);
  const heroHtml = renderChannelHero(card.channelChanges);

  const meshChanged =
    diff !== undefined &&
    (diff.brokenContracts.length > 0 ||
      diff.lostEdges.length > 0 ||
      diff.removedServices.length > 0 ||
      diff.addedServices.length > 0);
  const useFlow = meshChanged || slice.atRiskServiceEdges.length > 0;
  const useBands = !useFlow && slice.affectedFiles.length > 0 && slice.affectedFiles.length <= 50;
  const useRollup = !useFlow && slice.affectedFiles.length > 50;

  const behaviors = card.impactedCapabilities.slice(0, MAX_BEHAVIOR_CHIPS);
  const behaviorOverflow = card.impactedCapabilities.length - behaviors.length;
  const behaviorsHtml =
    behaviors.length > 0
      ? `<div class="behaviors"><span class="lbl">BEHAVIORS</span>${behaviors
          .map((name) => `<span class="chip">${escapeHtml(name)}</span>`)
          .join("")}${behaviorOverflow > 0 ? `<span class="chip mute">+${behaviorOverflow} more</span>` : ""}</div>`
      : "";

  let pictureTitle = "";
  let pictureBody = "";
  let pictureLegend = "";
  if (useFlow) {
    const flow = buildFlow(card, slice, diff);
    pictureTitle = "CALLS FLOW";
    pictureBody = flowSvg(flow, card.title);
    pictureLegend = flowLegend(flow);
    if (slice.affectedFiles.length > 0) {
      const maxDepth = Math.max(...slice.affectedFiles.map((f) => f.depth));
      pictureBody += `<p class="fanout">Also within reach via imports: ${plural(slice.affectedFiles.length, "file")} (depth ≤ ${maxDepth}).</p>`;
    }
  } else if (useBands) {
    pictureTitle = "IMPORT REACH · BY DEPTH";
    pictureBody = depthBands(slice);
    pictureLegend = `<span><i class="ln amber"></i>within reach, not broken</span>`;
  } else if (useRollup) {
    pictureTitle = "BLAST RADIUS · AGGREGATED";
    pictureBody = rollup(slice);
  }

  const context = input.contextServices ?? [];
  const contextHtml =
    useFlow && context.length > 0
      ? `<div class="surfaces"><span class="lbl">UNCHANGED · ${context.length} SERVICE${context.length === 1 ? "" : "S"}</span>${[...context]
          .sort()
          .slice(0, MAX_CONTEXT_CHIPS)
          .map((service) => `<span class="surf">${escapeHtml(shortService(service))}</span>`)
          .join("")}${context.length > MAX_CONTEXT_CHIPS ? `<span class="surf">+${context.length - MAX_CONTEXT_CHIPS} more</span>` : ""}</div>`
      : "";

  const { receipts, overflow } = buildReceipts(card, slice, diff);
  const evidenceHtml =
    receipts
      .map(
        (receipt) =>
          `<li><span class="dot ${receipt.tone}"></span><span class="loc ${receipt.tone}">${escapeHtml(receipt.loc)}</span>` +
          `<span class="fact">${escapeHtml(receipt.fact)}</span></li>`
      )
      .join("") + overflow.map((line) => `<li class="ev-more">${escapeHtml(line)}</li>`).join("");

  const honesty: string[] = [];
  honesty.push(
    card.baselineStale
      ? `<span class="hbit warn">Baseline stale — capability names may be outdated</span>`
      : `<span class="hbit ok">Baseline fresh</span>`
  );
  if (slice.unknownPaths.length > 0) {
    honesty.push(`<span class="hbit">${plural(slice.unknownPaths.length, "non-code file")} also changed</span>`);
  }
  if (card.narrationSource === "deterministic" && card.severity !== "cosmetic") {
    honesty.push(`<span class="hbit">narration: deterministic fallback (model unavailable or failed the leash)</span>`);
  }

  const cardCss = `.shift{max-width:1100px; margin:0 auto; display:flex; flex-direction:column; gap:18px}

.hdr{padding:24px 28px}
.sev-row{display:flex; align-items:center; gap:11px; margin-bottom:15px; flex-wrap:wrap}
.sev-tag{font-size:11px; font-weight:700; letter-spacing:0.08em; color:white; border-radius:6px; padding:4px 9px}
.sev-red{background:var(--red)} .sev-amber{background:var(--amber); color:oklch(20% 0.02 70)} .sev-blue{background:var(--blue)} .sev-dim{background:var(--faint)}
.sev-detail{font-family:var(--mono); font-size:12.5px; color:var(--dim)}
h1{font-size:25px; line-height:1.25; font-weight:700; letter-spacing:-0.02em; margin-bottom:9px; text-wrap:balance}
.changed{font-family:var(--mono); font-size:13px; color:var(--dim)}
.behaviors{display:flex; align-items:center; gap:9px; margin-top:17px; flex-wrap:wrap}
.lbl{font-size:11px; font-weight:650; letter-spacing:0.07em; color:var(--faint)}
.chip{font-size:12.5px; font-weight:550; color:var(--dim); border:1px solid var(--line); border-radius:999px; padding:5px 13px}
.chip.mute{color:var(--faint)}

.pic{padding:20px 24px 22px}
.pic-head{display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:6px; flex-wrap:wrap}
.legend{display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--dim)}
.legend span{display:inline-flex; align-items:center; gap:7px}
.ln{width:20px; height:0; border-top:2px solid var(--amber); display:inline-block}
.ln.red{border-top-color:var(--red)} .ln.blue{border-top-color:var(--blue)} .ln.green{border-top-color:var(--green)}
.ln.dash{border-top-style:dashed}
.flow{width:100%; height:auto; display:block; margin-top:6px}
.nlabel{font-family:var(--sans); font-weight:650; font-size:15px}
.nstatus{font-family:var(--sans); font-size:11.5px; font-weight:500}
.elabel{font-family:var(--mono); font-size:11.5px; font-weight:600}
.fanout{font-family:var(--sans); font-size:13px; line-height:1.55; color:var(--dim); margin-top:15px; padding-top:14px; border-top:1px solid var(--line-soft)}

.ripple-src{display:flex; align-items:center; gap:13px; margin:6px 0 18px; flex-wrap:wrap}
.src-pill{font-family:var(--mono); font-size:13.5px; font-weight:600; color:var(--ink); background:var(--blue-soft); border:1px solid var(--line); border-radius:10px; padding:9px 14px}
.src-note{font-size:12.5px; color:var(--faint)}
.bands{display:flex; flex-direction:column; gap:9px}
.band{display:grid; grid-template-columns:118px 1fr; gap:8px 18px; align-items:center;
  border:1px solid var(--line); border-left:3px solid var(--amber); border-radius:11px; padding:13px 16px}
.band .bn{font-family:var(--mono); font-size:12.5px; color:var(--amber); font-weight:600}
.band .bn b{font-size:21px; display:block; line-height:1.1}
.band .bf{font-family:var(--mono); font-size:12.5px; color:var(--dim); line-height:1.7; overflow-wrap:anywhere}
.mute{color:var(--faint)}

.stats{display:flex; gap:14px; flex-wrap:wrap; margin:4px 0 18px}
.stat{flex:1; min-width:120px; border:1px solid var(--line); border-radius:12px; padding:15px 17px}
.stat .num{font-size:34px; font-weight:730; letter-spacing:-0.03em; line-height:1}
.stat.warn .num{color:var(--amber)}
.stat .unit{font-size:12px; color:var(--faint); margin-top:6px; line-height:1.35}
.dist{display:flex; flex-direction:column; gap:7px; margin-bottom:18px}
.distrow{display:flex; align-items:center; gap:11px; font-family:var(--mono); font-size:11.5px; color:var(--faint)}
.distrow .dlabel{width:58px; flex:none}
.distrow .dbar{flex:1; height:9px; background:var(--line-soft); border-radius:5px; overflow:hidden}
.distrow .dbar i{display:block; height:100%; background:var(--amber); border-radius:5px}
.distrow .dcount{width:46px; flex:none; text-align:right; color:var(--ink)}
.entries ul{list-style:none; display:flex; flex-direction:column; gap:8px; margin-top:11px; padding:0}
.entries li{font-family:var(--mono); font-size:12.5px; color:var(--dim)}

.surfaces{border-top:1px solid var(--line-soft); margin-top:18px; padding-top:16px; display:flex; align-items:center; gap:9px; flex-wrap:wrap}
.surf{font-family:var(--mono); font-size:11.5px; font-weight:500; color:var(--faint); border:1px solid var(--line-soft); border-radius:9px; padding:6px 11px}

.duo{display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start}
@media (max-width:900px){ .duo{grid-template-columns:1fr} }
.panel{padding:20px 24px}
.panel h2{font-size:11px; font-weight:680; letter-spacing:0.09em; color:var(--faint); margin-bottom:14px}
.narr{font-size:15px; line-height:1.6; color:var(--ink); text-wrap:pretty}
.ev{display:flex; flex-direction:column; gap:11px; list-style:none; padding:0}
.ev li{display:flex; gap:10px; align-items:baseline; font-family:var(--mono); font-size:12.5px; line-height:1.5; flex-wrap:wrap}
.ev .dot{width:8px; height:8px; border-radius:50%; flex:none; transform:translateY(1px)}
.dot.red{background:var(--red)} .dot.green{background:var(--green)} .dot.blue{background:var(--blue)} .dot.amber{background:var(--amber)}
.ev .loc{font-weight:600}
.loc.red{color:var(--red)} .loc.green{color:var(--green)} .loc.blue{color:var(--blue)} .loc.amber{color:var(--amber)}
.ev .fact{color:var(--faint)}
.ev .ev-more{color:var(--faint); font-size:12px}

.footrail{display:flex; align-items:center; gap:13px; flex-wrap:wrap; padding:14px 24px}
.grounded{font-size:12.5px; font-weight:600; color:var(--green)}
.ft-note{font-size:12.5px; color:var(--dim)}
.footrail .spacer{flex:1}
.hbit{font-size:12px; font-weight:550; color:var(--dim); background:var(--line-soft); border-radius:8px; padding:5px 11px}
.hbit.ok{color:var(--green); background:var(--green-soft)}
.hbit.warn{color:var(--amber); background:var(--amber-soft)}

/* the diff-first channel hero */
.chero{padding:20px 24px 22px}
.crows{display:flex; flex-direction:column; gap:12px; margin-top:12px}
.crow{border:1px solid var(--line); border-left:3px solid var(--amber); border-radius:12px; padding:14px 16px}
.crow.green{border-left-color:var(--green)} .crow.red{border-left-color:var(--red)} .crow.amber{border-left-color:var(--amber)}
.chead{display:flex; align-items:center; gap:10px; flex-wrap:wrap}
.ctag{font-size:10.5px; font-weight:700; letter-spacing:0.07em; color:white; border-radius:5px; padding:3px 8px}
.ctag.green{background:var(--green)} .ctag.red{background:var(--red)} .ctag.amber{background:var(--amber); color:oklch(20% 0.02 70)}
.cdesc{font-size:13.5px; color:var(--ink)} .cdesc code{font-family:var(--mono); font-weight:600}
.cpill{font-size:11px; font-weight:600; border-radius:999px; padding:3px 10px}
.cpill.ok{color:var(--green); background:var(--green-soft)}
.cpill.gone{color:var(--red); background:var(--red-soft, color-mix(in oklab, var(--red) 14%, transparent))}
.cpill.inf{color:var(--amber); background:var(--amber-soft)}
.cnarr{font-size:13.5px; line-height:1.55; color:var(--dim); margin:9px 0 2px}
.proof{display:flex; flex-direction:column; gap:6px; margin-top:10px; border-top:1px solid var(--line-soft); padding-top:10px}
.prow{display:flex; gap:10px; align-items:baseline; font-family:var(--mono); font-size:12px; line-height:1.5; flex-wrap:wrap}
.prole{font-weight:700; font-size:10px; letter-spacing:0.05em; text-transform:uppercase; border-radius:4px; padding:2px 6px}
.prole.green{color:var(--green); background:var(--green-soft)} .prole.blue{color:var(--blue); background:var(--blue-soft)} .prole.amber{color:var(--amber); background:var(--amber-soft)}
.proof .ploc{font-weight:600; color:var(--ink)} .proof .ptext{color:var(--faint)}
.pic.backdrop{opacity:0.72}`;

  const cardBody = `<div class="content"><div class="shift">
  <div class="card hdr">
    <div class="sev-row"><span class="sev-tag ${severity.cls}">${severity.label}</span><span class="sev-detail">${escapeHtml(severity.detail)}</span></div>
    <h1>${escapeHtml(card.title)}</h1>
    <div class="changed">${escapeHtml(card.changedSummary)}</div>
    ${behaviorsHtml}
  </div>
${heroHtml ? `  ${heroHtml}\n` : ""}${
  pictureBody
    ? `  <div class="card pic${heroHtml ? " backdrop" : ""}">
    <div class="pic-head"><span class="lbl">${pictureTitle}${heroHtml ? ` · context` : ""}</span><div class="legend">${pictureLegend}</div></div>
    ${pictureBody}
    ${contextHtml}
  </div>
`
    : ""
}  <div class="duo">
    <div class="card panel"><h2>WHAT CHANGED</h2><p class="narr">${escapeHtml(card.narration)}</p></div>
    <div class="card panel"><h2>EVIDENCE</h2><ul class="ev">${evidenceHtml || `<li class="ev-more">no downstream facts — nothing depends on what changed</li>`}</ul></div>
  </div>
  <div class="card footrail">
    <span class="grounded">Grounded · Leashed</span>
    <span class="ft-note">Every node, edge, and number above is backed by a real code fact — nothing is guessed.</span>
    <span class="spacer"></span>
    ${honesty.join("\n    ")}
    ${feedbackLink()}
  </div>
</div></div>`;

  const navHtml = [
    navItem({ icon: "i-shift", label: "Shifts", href: "../index.html", active: true }),
    navItem({ icon: "i-service", label: "Studio", href: "../index.html" }),
    navItem({ icon: "i-grid", label: "Capabilities", href: "../index.html" }),
    navItem({ icon: "i-contract", label: "Contracts", href: "../index.html" })
  ].join("");

  return renderShell({
    title: `${input.repoName ? `${input.repoName} · ` : ""}${card.title} · mappamind`,
    crumb: `<b>Shifts</b><span class="sep">/</span>${escapeHtml(card.title)}`,
    navHtml,
    headExtra: cardCss,
    content: cardBody
  });
}
