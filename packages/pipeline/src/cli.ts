#!/usr/bin/env node
// Run the real baseline pipeline against one or more repos, using the host's
// `claude -p`. Usage:
//   mappamind-baseline <repoRoot> [<repoRoot> ...]
//   mappamind-baseline --label app=/path/to/app backend=/path/to/backend
// Prints a legible summary and writes baseline.json to the daemon store (D12).

import { basename, resolve } from "node:path";

import { selectModelClient } from "@mappamind_/synthesis";

import { collectAndBuild } from "./run.js";
import type { RepoSpec } from "./run.js";

function parseArgs(argv: readonly string[]): RepoSpec[] {
  const specs: RepoSpec[] = [];
  for (const arg of argv) {
    if (arg === "--label") {
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq > 0) {
      specs.push({ repo: arg.slice(0, eq), root: resolve(arg.slice(eq + 1)) });
    } else {
      const root = resolve(arg);
      specs.push({ repo: basename(root), root });
    }
  }
  return specs;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  // Pull --host out before parseArgs (which treats every remaining arg as a repo).
  const hostIdx = argv.indexOf("--host");
  let host: string | undefined;
  if (hostIdx >= 0) {
    host = argv[hostIdx + 1];
    argv.splice(hostIdx, hostIdx + 1 < argv.length ? 2 : 1);
  }
  const specs = parseArgs(argv);
  if (specs.length === 0) {
    console.error("usage: mappamind-baseline [--host claude|codex] <repoRoot> [<repoRoot> ...]");
    process.exit(2);
  }

  console.error(`Collecting facts from ${specs.length} repo(s)...`);
  const client = selectModelClient({ timeoutMs: 300_000, ...(host === undefined ? {} : { host }) });
  const result = await collectAndBuild({ repos: specs, client });

  const { synthesis, collected, model, storePath, architecture, seams } = result;
  const { baseline, droppedCapabilities, droppedEdges, repoErrors } = synthesis;

  console.log("\n=== COVERAGE ===");
  for (const summary of collected) {
    console.log(
      `  ${summary.repo}: ${summary.filesExtracted}/${summary.filesSeen} files extracted` +
        ` [${summary.languages.join(", ") || "none"}]` +
        (summary.parseErrors ? `  (${summary.parseErrors} parse errors)` : "")
    );
  }
  console.log(`  model: ${model.modules.length} modules, ${model.edges.length} edges, ${model.unresolvedImports} unresolved imports`);

  if (architecture.edges.length > 0 || architecture.dangling.length > 0) {
    const short = (service: string): string => service.replace(/^(src|services|apps|packages)\//, "");
    console.log("\n=== SERVICE MESH (who calls whom, via RPC) ===");
    for (const edge of architecture.edges) {
      console.log(`  ${short(edge.from)} ──▶ ${short(edge.to)}   [${edge.contract}]`);
    }
    if (architecture.dangling.length > 0) {
      console.log("\n  ⚠ DANGLING CONTRACTS (a client calling a service that isn't here):");
      for (const dangling of architecture.dangling) {
        console.log(`      ${short(dangling.service)} ──▶ [${dangling.contract}]  no such service   (${dangling.file}:${dangling.line})`);
      }
    }
  }

  console.log("\n=== CAPABILITIES (grounded) ===");
  for (const cap of baseline.capabilities) {
    console.log(`  • ${cap.name}  [${cap.confidence}]  — ${cap.summary}`);
    for (const member of cap.members.slice(0, 4)) {
      console.log(`      ${member.repo}/${member.file}${member.symbol ? `:${member.symbol}` : ""}`);
    }
    if (cap.members.length > 4) {
      console.log(`      … +${cap.members.length - 4} more`);
    }
  }

  if (baseline.edges.length > 0) {
    console.log("\n=== EDGES ===");
    for (const edge of baseline.edges) {
      console.log(`  ${edge.from} -> ${edge.to}  (${edge.via})`);
    }
  }

  if (baseline.unknowns.length > 0) {
    console.log("\n=== UNKNOWNS (flagged, not guessed) ===");
    for (const unknown of baseline.unknowns) {
      console.log(`  ? ${unknown.note}${unknown.where ? `  [${unknown.where.repo}${unknown.where.file ? `/${unknown.where.file}` : ""}]` : ""}`);
    }
  }

  console.log("\n=== LEASH (what the grounding dropped) ===");
  console.log(`  dropped capabilities: ${droppedCapabilities.length}`);
  console.log(`  dropped edges:        ${droppedEdges.length}`);
  if (repoErrors.length > 0) {
    console.log(`  repo errors:          ${repoErrors.length}`);
    for (const error of repoErrors) {
      console.log(`      ${error.repo}: ${error.error}`);
    }
  }

  console.log(`\nBaseline: ${baseline.capabilities.length} capabilities, ${baseline.edges.length} edges, ${baseline.unknowns.length} unknowns`);
  if (storePath) {
    console.log(`Stored:   ${storePath}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
