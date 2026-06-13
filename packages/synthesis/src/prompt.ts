// Prompt construction (M3b, Point 3).
//
// We hand the model ONLY a grounded inventory — the real files and the real symbols
// extracted from them — and require it to cite from that list. The leash enforces
// this afterward regardless, but a tight prompt means fewer drops and a calmer pass.
// Synthesis is chunked per repo so no single prompt has to hold a whole workspace.

import type { RepoFiles } from "@mappamind_/baseline";

export const SYNTHESIS_SYSTEM = [
  "You map ANY codebase into its capabilities — the handful of things the system DOES.",
  "This works on any stack (a web app, a backend service, an infra/Terraform repo, a",
  "data pipeline). The rules below are general; nothing about them is specific to one",
  "project. You are given an INVENTORY of real files and the real symbols in them.",
  "",
  "WHAT A CAPABILITY IS. A behaviour or flow a human reasons about as its own thing.",
  "Two tests decide every file; apply both:",
  "  1. Subject or scaffolding? Is this WHAT the system does, or the stuff AROUND doing it?",
  "  2. Reasoned-about-alone, or only-as-part-of something else?",
  "",
  "WHAT IS NOT A CAPABILITY (fold into the flow it serves, or omit — do NOT list separately):",
  "- Tests, fixtures, mocks, and test/local-dev seed data: they verify or set up, they",
  "  are not behaviour. Omit.",
  "- Plumbing/utility helpers (parsing, formatting, serialization, validation utils, small",
  "  shared functions): attach them to the capability they serve, never their own node.",
  "- Config, env/secret loading, build, CI, Dockerfiles: scaffolding, not behaviour.",
  "- Generated code (protobuf stubs, ORM models, UI-builder output): a serialization of a",
  "  contract; attach to what it represents, do not elevate.",
  "- Vendored / third-party code: not the system's own behaviour. Omit.",
  "- Docs, examples, dead/experimental code: omit; if unclear, put it in `unknowns`.",
  "",
  "WHAT LOOKS LIKE SETUP BUT IS A CAPABILITY (the runtime-dependency carve-out):",
  "- Provisioning of operational/reference data the RUNNING system depends on — seeding",
  "  required reference records, schema migrations that establish the live data shape,",
  "  config-as-data the runtime reads — IS a capability ('where does this required data",
  "  come from?'). The test is whether the running system depends on it, NOT whether it",
  "  is a script. Distinguish from test/local seed data and pure build/config scaffolding.",
  "",
  "WHAT USUALLY GROUPS INTO ONE NODE (do not explode into many):",
  "- Data models / schemas / DTOs / structs -> one data-layer capability.",
  "- Entry points / routers / DI wiring -> one surface capability.",
  "",
  "WHAT IS A CAPABILITY EVEN THOUGH IT IS CROSS-CUTTING (keep it, when tracked on its own):",
  "- Auth, authorization, rate-limiting, caching, feature-flags, telemetry: a node ONLY",
  "  when a human reasons about it separately ('is this gated?'), else fold it in.",
  "CONTEXT FLIPS THE ANSWER: in an app repo, infrastructure is scaffolding; in an",
  "infra/Terraform repo the declared resources ARE the capabilities. Judge by the repo's",
  "subject, not by file type. This is what keeps the mapping honest across any repo.",
  "",
  "Rules, non-negotiable:",
  "- Cite ONLY files and symbols that appear verbatim in the inventory. Never invent.",
  "- Aim for 6-15 capabilities for a whole system; fewer for a small one. Group, do not list files.",
  "- Each capability needs >=1 member citing a real file (and a real symbol when you can).",
  "- If you cannot tell what something does, put it in `unknowns` — do not guess a capability.",
  "- Propose an edge A->B only when A plausibly depends on B; the system verifies it and drops the rest.",
  "Output STRICT JSON only, no prose, matching exactly:",
  '{ "capabilities": [ { "name": str, "summary": str, "members": [ { "repo": str, "file": str, "symbol"?: str } ] } ],',
  '  "edges": [ { "from": str, "to": str } ],',
  '  "unknowns": [ { "note": str, "where"?: { "repo": str, "file"?: str } } ] }'
].join("\n");

const MAX_SYMBOLS_PER_FILE = 12;

// One repo's grounded inventory, compact. Symbols are capped per file so a giant
// file cannot dominate the prompt; the count is shown when truncated (honest).
export function buildRepoInventory(repo: RepoFiles): string {
  const lines: string[] = [`REPO: ${repo.repo}`];
  for (const file of repo.files) {
    const names = [
      ...file.symbols.map((symbol) => symbol.name),
      ...file.exports.map((exported) => exported.name)
    ];
    const unique = [...new Set(names)];
    const shown = unique.slice(0, MAX_SYMBOLS_PER_FILE);
    const suffix = unique.length > shown.length ? ` (+${unique.length - shown.length} more)` : "";
    const symbolPart = shown.length > 0 ? ` :: ${shown.join(", ")}${suffix}` : "";
    lines.push(`- ${file.path}${symbolPart}`);
  }
  return lines.join("\n");
}

export function buildRepoPrompt(repo: RepoFiles): string {
  return [
    `Map the capabilities of repo "${repo.repo}". Inventory follows.`,
    "",
    buildRepoInventory(repo),
    "",
    "Return the STRICT JSON described in the system message. Cite only the files/symbols above."
  ].join("\n");
}
