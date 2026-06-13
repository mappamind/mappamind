// Candidate surfacer — the deterministic floor's contribution to channel detection.
// NO MODEL, and NO framework / language / repo-specific recognition. It surfaces
// candidates (real + noise — both fine); it never judges channel-vs-not. The only
// operations are workspace-agnostic, so this can never grow into a catcher script:
//
//   1. take every string ANCHOR (extracted generically from the AST),
//   2. normalize it with universal rules only (drop scheme/query, collapse path
//      params, lowercase) — no `api/`, no `MapGet`, no `pages/api`, nothing tuned,
//   3. a STRUCTURED key (≥2 path segments) appearing in two different services is a
//      candidate channel linking them, carrying EVERY cited site as an AnchorRef.
//
// Recognition — which strings are routes, direction, base+fragment composition,
// file-based routes, any framework idiom — is the model's job (Phase 3), behind a
// deterministic verifier (Phase 4). This tier only surfaces identical shared names.
//
// Channel-as-node from day one (plan §11.1): a candidate holds N endpoints across
// M services, never a pre-expanded mesh of pairs. Ubiquity is a RANKING signal, not
// a filter — a route consumed by 4 services is a real hub, and the old
// UBIQUITY_LIMIT hard-drop deleted exactly those (removed here, see plan C5).

import type { FileFacts } from "@mappamind_/extractors";

import type { AnchorRef, ChannelCandidate } from "./channel.js";

// Universal normalization: scheme, query/hash, path-param placeholders, case,
// slashes. URL/string conventions, a closed universal set — not per framework. A
// key must be STRUCTURED (≥2 segments) so bare words ("name", "id", "error") can't
// collide into edges.
export function normKey(raw: string): string | null {
  if (/\s/.test(raw)) return null; // channel names don't contain whitespace
  let s = raw.trim();
  // If there's a scheme, drop scheme + authority (host[:port]) and keep the path —
  // so a full URL and a bare path normalize to the SAME key (else real edges are
  // missed: the recall ceiling, plan go-condition #2). Pure URL grammar, not a
  // framework rule.
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i.exec(s);
  if (scheme) s = scheme[1] ?? "";
  s = s.split("?")[0]!.split("#")[0]!;
  s = s
    .replace(/\{[^}]*\}/g, "{}")
    .replace(/:[A-Za-z_]\w*/g, "{}")
    .replace(/\[[^\]]*\]/g, "{}")
    .replace(/\$\{[^}]*\}/g, "{}");
  s = s.toLowerCase().replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  const segs = s.split("/").filter(Boolean);
  if (segs.length < 2) return null; // structured keys only
  if (segs.every((seg) => seg === "{}")) return null; // all-placeholder is not a name
  return s;
}

export type SurfaceOptions = {
  // Extra candidates from declarative contracts/IaC (proto/openapi/graphql/tf),
  // already keyed and grounded by a contract reader. Merged in as source
  // "contract-file" (plan Phase 2.4). Empty until that reader is wired.
  readonly contractCandidates?: readonly ChannelCandidate[];
};

// Surface candidate channels from string anchors shared across service boundaries.
export function surfaceChannelCandidates(
  files: readonly FileFacts[],
  serviceByPath: ReadonlyMap<string, string>,
  options: SurfaceOptions = {}
): ChannelCandidate[] {
  // key -> service -> the cited sites (AnchorRefs) in that service
  const byKey = new Map<string, Map<string, AnchorRef[]>>();
  for (const file of files) {
    const service = serviceByPath.get(file.path);
    if (!service) continue;
    // Exclude import module specifiers — `imports` is a generic fact in every
    // language, so this prunes import-path noise (`@/x`, `next/font/google`)
    // without any framework knowledge.
    const importModules = new Set(file.imports.map((i) => i.module));
    const seen = new Set<string>(); // dedupe identical (key,line,text) within a file
    for (const a of file.anchors ?? []) {
      if (importModules.has(a.text)) continue;
      const key = normKey(a.text);
      if (!key) continue;
      const dedupe = `${key}${a.line}${a.text}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      let svcs = byKey.get(key);
      if (!svcs) byKey.set(key, (svcs = new Map()));
      let refs = svcs.get(service);
      if (!refs) svcs.set(service, (refs = []));
      refs.push({ service, file: file.path, line: a.line, text: a.text });
    }
  }

  const candidates: ChannelCandidate[] = [];
  for (const [key, svcs] of byKey) {
    if (svcs.size < 2) continue; // a channel spans ≥2 services by definition
    const endpoints: AnchorRef[] = [];
    for (const refs of svcs.values()) endpoints.push(...refs);
    // Stable order so the candidate set is deterministic across runs (§I5).
    endpoints.sort((x, y) => x.service.localeCompare(y.service) || x.file.localeCompare(y.file) || x.line - y.line);
    candidates.push({ key, endpoints, ubiquity: svcs.size, source: "string-match" });
  }

  if (options.contractCandidates) candidates.push(...options.contractCandidates);

  // Rank by ubiquity DESC then key, so hubs surface first — ranking only, nothing dropped.
  candidates.sort((a, b) => b.ubiquity - a.ubiquity || a.key.localeCompare(b.key));
  return candidates;
}
