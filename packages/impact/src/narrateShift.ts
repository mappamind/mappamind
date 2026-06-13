// narrateShift: the leashed narrator. ImpactSlice (+ MeshDiff) -> ShiftCard.
//
// The model is asked for exactly three things: a title, a 2-3 sentence
// narration, and a judgment on the danglings the floor could not prove
// (external-SDK adoption vs unknown). Its answer is then AUDITED: every
// path-like or service-like token in the narration must name something in the
// slice. One retry with feedback; a second failure (or a dead client, or
// unparseable output) falls back to the deterministic narration, which is
// grounded by construction. The card always renders; it is never ungrounded.
//
// Economics (POC-E): a cosmetic slice never calls the model; large file lists
// are capped in the prompt (the count is the message, the leash set still
// holds every real name).

import type { ModelClient } from "@mappamind_/synthesis";

import type { ChannelChange } from "./channelDiff.js";
import type { MeshDiff } from "./meshDiff.js";
import type { ImpactSlice } from "./types.js";
import {
  buildChangedSummary,
  buildFallbackNarration,
  buildFallbackTitle,
  classifyBrokenContracts,
  computeSeverity
} from "./shiftCard.js";
import type { BrokenContract, ShiftCard } from "./shiftCard.js";

export type NarrateShiftInput = {
  readonly slice: ImpactSlice;
  readonly client: ModelClient;
  readonly diff?: MeshDiff;
  readonly changedSummary?: string; // caller-provided fact (e.g. from git); never model-written
  readonly baselineStale?: boolean;
  readonly channelChanges?: readonly ChannelChange[]; // verified channel deltas (hero rows)
};

const MAX_LISTED_FILES = 30;

// ---- the leash: what the narration is allowed to name -------------------------

type AllowedVocabulary = {
  readonly paths: ReadonlySet<string>;
  readonly serviceKeys: ReadonlySet<string>;
};

function serviceKey(raw: string): string {
  const last = raw.split("/").filter(Boolean).pop() ?? raw;
  return last
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/service$/, "")
    .replace(/s$/, "");
}

function buildAllowedVocabulary(
  slice: ImpactSlice,
  brokenContracts: readonly BrokenContract[],
  diff?: MeshDiff
): AllowedVocabulary {
  const paths = new Set<string>([...slice.changedPaths, ...slice.unknownPaths]);
  for (const affected of slice.affectedFiles) paths.add(affected.path);
  for (const contract of slice.atRiskContracts) {
    for (const file of contract.definedIn) paths.add(file);
    for (const consumer of contract.consumers) paths.add(consumer.file);
  }
  for (const broken of brokenContracts) paths.add(broken.file);

  const serviceKeys = new Set<string>();
  const addService = (name: string): void => {
    const key = serviceKey(name);
    if (key.length > 0) serviceKeys.add(key);
  };
  for (const edge of slice.atRiskServiceEdges) {
    addService(edge.consumer);
    addService(edge.provider);
    addService(edge.contract);
  }
  for (const contract of slice.atRiskContracts) addService(contract.key);
  for (const broken of brokenContracts) {
    addService(broken.service);
    addService(broken.contract);
  }
  if (diff) {
    for (const edge of [...diff.lostEdges, ...diff.newEdges]) {
      addService(edge.from);
      addService(edge.to);
      addService(edge.contract);
    }
    for (const service of [...diff.removedServices, ...diff.addedServices]) addService(service);
  }
  return { paths, serviceKeys };
}

// Path-like tokens (contain a slash or a code extension) and service-like
// tokens (…service / …Service) must resolve against the vocabulary. Everything
// else is prose and not auditable — same pragmatic audit POC-A validated.
export function auditNarration(narration: string, allowed: AllowedVocabulary): string[] {
  const ungrounded: string[] = [];

  const pathLike = narration.match(/[A-Za-z0-9_$@-]+(?:[./][A-Za-z0-9_$@.-]+)+/g) ?? [];
  for (const raw of pathLike) {
    const token = raw.replace(/:\d+$/, "").replace(/[.,;]$/, "");
    const looksLikePath = token.includes("/") || /\.(ts|tsx|js|jsx|mjs|cjs|go|py|dart|java|cs|rb|rs|php|kt|swift|scala|c|cc|cpp|h|hpp)$/.test(token);
    if (!looksLikePath) continue;
    const known =
      allowed.paths.has(token) ||
      [...allowed.paths].some(
        (path) =>
          path === token ||
          path.endsWith(`/${token}`) || // a basename or path tail of a slice file
          token.endsWith(`/${path}`) ||
          path.startsWith(`${token}/`) // a directory that CONTAINS slice files (e.g. src/checkoutservice)
      );
    if (!known) ungrounded.push(token);
  }

  const serviceLike = narration.match(/\b[A-Za-z][\w-]*[Ss]ervice\b/g) ?? [];
  for (const raw of serviceLike) {
    const key = serviceKey(raw);
    if (key.length === 0) continue;
    if (!allowed.serviceKeys.has(key)) ungrounded.push(raw);
  }

  return [...new Set(ungrounded)];
}

// ---- the model exchange --------------------------------------------------------

type ModelAnswer = {
  readonly title: string;
  readonly narration: string;
  readonly judgments: ReadonlyMap<string, "external-service" | "unknown">; // service::contract
};

function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return candidate.slice(start, end + 1);
}

function parseModelAnswer(text: string): ModelAnswer {
  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  const title = typeof parsed["title"] === "string" ? parsed["title"].trim() : "";
  const narration = typeof parsed["narration"] === "string" ? parsed["narration"].trim() : "";
  if (narration.length === 0) throw new Error("model returned no narration");

  const judgments = new Map<string, "external-service" | "unknown">();
  if (Array.isArray(parsed["danglingJudgments"])) {
    for (const entry of parsed["danglingJudgments"]) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const service = typeof record["service"] === "string" ? record["service"] : null;
      const contract = typeof record["contract"] === "string" ? record["contract"] : null;
      const kind = record["kind"] === "external-service" ? "external-service" : "unknown";
      if (service && contract) judgments.set(`${service}::${contract}`, kind);
    }
  }
  return { title, narration, judgments };
}

const SYSTEM =
  "You narrate what an AI coding agent just did to a software system, for a human deciding whether to accept the change. " +
  "STRICT RULE (the leash): mention ONLY services, contracts, capabilities, and files that appear in the FACTS JSON. Never invent or guess. " +
  "Lead with the risk; 2-3 concrete sentences. " +
  'For each entry in "judgeDanglings", decide: "external-service" (the contract is a managed/cloud SDK outside this workspace, e.g. a cloud secrets or storage client) or "unknown". ' +
  'Return STRICT JSON only: {"title": string (<=80 chars), "narration": string, "danglingJudgments": [{"service": string, "contract": string, "kind": "external-service"|"unknown", "reason": string}]}';

function buildPrompt(
  slice: ImpactSlice,
  brokenContracts: readonly BrokenContract[],
  diff?: MeshDiff,
  changedSummary?: string
): string {
  const listedFiles = slice.affectedFiles.slice(0, MAX_LISTED_FILES);
  const facts = {
    whatChanged: changedSummary ?? buildChangedSummary(slice),
    changedPaths: slice.changedPaths,
    affectedFileCount: slice.affectedFiles.length,
    affectedFiles: listedFiles.map((file) => file.path),
    ...(slice.affectedFiles.length > listedFiles.length
      ? { affectedFilesNote: `showing ${listedFiles.length} of ${slice.affectedFiles.length}` }
      : {}),
    affectedCapabilities: slice.affectedCapabilities.map((capability) => capability.name),
    atRiskServiceEdges: slice.atRiskServiceEdges,
    atRiskContracts: slice.atRiskContracts.map((contract) => ({
      key: contract.key,
      consumers: contract.consumers.map((consumer) => `${consumer.file}:${consumer.line}`)
    })),
    provenBrokenContracts: brokenContracts
      .filter((contract) => contract.kind === "internal-break")
      .map((contract) => ({ consumer: contract.service, contract: contract.contract, at: `${contract.file}:${contract.line}` })),
    judgeDanglings: brokenContracts
      .filter((contract) => contract.kind === "unknown")
      .map((contract) => ({ service: contract.service, contract: contract.contract, at: `${contract.file}:${contract.line}` })),
    ...(diff
      ? {
          lostEdges: diff.lostEdges.map((edge) => `${edge.from}->${edge.to}[${edge.contract}]`),
          removedServices: diff.removedServices,
          addedServices: diff.addedServices
        }
      : {})
  };
  return `FACTS of one agent session's impact (grounded; cite nothing beyond them):\n\n${JSON.stringify(facts, null, 2)}`;
}

// ---- orchestration ---------------------------------------------------------------

export async function narrateShift(input: NarrateShiftInput): Promise<ShiftCard> {
  const slice = input.slice;
  const classified = input.diff ? classifyBrokenContracts(input.diff) : [];
  const changedSummary = input.changedSummary ?? buildChangedSummary(slice);
  const baselineStale = input.baselineStale ?? false;
  const impactedCapabilities = slice.affectedCapabilities.map((capability) => capability.name);
  const channelChanges = input.channelChanges ?? [];

  // The cosmetic fold: deterministic card, zero model calls, the caller folds.
  const preSeverity = computeSeverity(slice, classified, input.diff);
  if (preSeverity === "cosmetic") {
    return {
      title: buildFallbackTitle("cosmetic", classified, slice),
      changedSummary,
      narration: buildFallbackNarration(slice, classified),
      narrationSource: "deterministic",
      severity: "cosmetic",
      baselineStale,
      impactedCapabilities,
      brokenContracts: classified,
      channelChanges
    };
  }

  const allowed = buildAllowedVocabulary(slice, classified, input.diff);
  const basePrompt = buildPrompt(slice, classified, input.diff, changedSummary);

  let answer: ModelAnswer | null = null;
  let prompt = basePrompt;
  for (let attempt = 0; attempt < 2 && answer === null; attempt += 1) {
    let candidate: ModelAnswer;
    try {
      const response = await input.client.complete({ system: SYSTEM, prompt });
      candidate = parseModelAnswer(response.text);
    } catch {
      break; // dead client or unparseable twice -> deterministic fallback
    }
    const ungrounded = auditNarration(`${candidate.title} ${candidate.narration}`, allowed);
    if (ungrounded.length === 0) {
      answer = candidate;
    } else {
      prompt =
        `${basePrompt}\n\nYour previous answer mentioned ${ungrounded.join(", ")}, which is NOT in the facts. ` +
        "Rewrite mentioning only items from the facts. STRICT JSON only.";
    }
  }

  // Apply the model's judgments ONLY where the floor said "unknown" — a proven
  // internal-break can never be downgraded.
  const brokenContracts: BrokenContract[] = classified.map((contract) => {
    if (contract.kind !== "unknown" || answer === null) return contract;
    const judged = answer.judgments.get(`${contract.service}::${contract.contract}`);
    return judged === "external-service" ? { ...contract, kind: judged, kindSource: "model" } : contract;
  });

  const severity = computeSeverity(slice, brokenContracts, input.diff);
  return {
    title: answer !== null && answer.title.length > 0 ? answer.title : buildFallbackTitle(severity, brokenContracts, slice),
    changedSummary,
    narration: answer !== null ? answer.narration : buildFallbackNarration(slice, brokenContracts),
    narrationSource: answer !== null ? "model" : "deterministic",
    severity,
    baselineStale,
    impactedCapabilities,
    brokenContracts,
    channelChanges
  };
}
