// Parse a model response into an untrusted ProposedBaseline.
//
// Models wrap JSON in prose or ```json fences; we extract the outermost object and
// coerce it into the proposed shape, defending every field. This produces only the
// UNTRUSTED proposal — the leash (groundBaseline) is what makes it safe. A response
// with no recoverable JSON object throws; the caller records it and that repo yields
// nothing rather than something fabricated.

import type {
  Citation,
  ProposedBaseline,
  ProposedCapability,
  ProposedEdge,
  ProposedUnknown
} from "@mappamind_/baseline";

export function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("model response contained no JSON object");
  }
  return candidate.slice(start, end + 1);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function toCitation(value: unknown): Citation | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const repo = asString(record["repo"]);
  const file = asString(record["file"]);
  if (!repo || !file) {
    return null;
  }
  const symbol = asString(record["symbol"]);
  const line = typeof record["line"] === "number" ? (record["line"] as number) : undefined;
  return { repo, file, ...(symbol ? { symbol } : {}), ...(line !== undefined ? { line } : {}) };
}

function toCapability(value: unknown): ProposedCapability | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const name = asString(record["name"]);
  if (!name) {
    return null;
  }
  const members = Array.isArray(record["members"])
    ? (record["members"].map(toCitation).filter((member): member is Citation => member !== null))
    : [];
  return { name, summary: asString(record["summary"]) ?? "", members };
}

function toEdge(value: unknown): ProposedEdge | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const from = asString(record["from"]);
  const to = asString(record["to"]);
  if (!from || !to) {
    return null;
  }
  const reason = asString(record["reason"]);
  return { from, to, ...(reason ? { reason } : {}) };
}

function toUnknown(value: unknown): ProposedUnknown | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const note = asString(record["note"]);
  if (!note) {
    return null;
  }
  const where = record["where"];
  if (typeof where === "object" && where !== null) {
    const whereRecord = where as Record<string, unknown>;
    const repo = asString(whereRecord["repo"]);
    if (repo) {
      const file = asString(whereRecord["file"]);
      return { note, where: { repo, ...(file ? { file } : {}) } };
    }
  }
  return { note };
}

export function parseProposal(text: string): ProposedBaseline {
  const parsed = JSON.parse(extractJsonObject(text)) as Record<string, unknown>;
  const capabilities = Array.isArray(parsed["capabilities"])
    ? parsed["capabilities"].map(toCapability).filter((cap): cap is ProposedCapability => cap !== null)
    : [];
  const edges = Array.isArray(parsed["edges"])
    ? parsed["edges"].map(toEdge).filter((edge): edge is ProposedEdge => edge !== null)
    : [];
  const unknowns = Array.isArray(parsed["unknowns"])
    ? parsed["unknowns"].map(toUnknown).filter((unknown): unknown is ProposedUnknown => unknown !== null)
    : [];
  return { capabilities, edges, unknowns };
}
