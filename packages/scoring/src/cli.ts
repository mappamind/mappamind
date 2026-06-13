#!/usr/bin/env node
// Score a stored baseline against a ratified ground-truth fixture. Usage:
//   mappamind-score <baseline.json> <ground-truth.json>
// The ground-truth path is intentionally external — keep private fixtures out of git.

import { readFile } from "node:fs/promises";

import type { Baseline } from "@mappamind_/baseline";

import { validateGroundTruth } from "./groundTruth.js";
import { DEFAULT_THRESHOLDS, scoreBaseline } from "./score.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mark(passed: boolean): string {
  return passed ? "PASS" : "FAIL";
}

async function main(): Promise<void> {
  const [baselinePath, groundTruthPath] = process.argv.slice(2);
  if (!baselinePath || !groundTruthPath) {
    console.error("usage: mappamind-score <baseline.json> <ground-truth.json>");
    process.exit(2);
  }

  const baseline = JSON.parse(await readFile(baselinePath, "utf8")) as Baseline;
  const groundTruth = validateGroundTruth(JSON.parse(await readFile(groundTruthPath, "utf8")));
  const report = scoreBaseline(baseline, groundTruth, DEFAULT_THRESHOLDS);

  console.log(`\n=== SCORE: ${report.label} ===`);
  console.log(`  produced ${report.producedCount} capabilities, expected ${report.expectedCount}, matched ${report.matchedCount}`);
  console.log(`  precision  ${pct(report.precision)}  (>= ${pct(DEFAULT_THRESHOLDS.precision)})  ${mark(report.pass.precision)}`);
  console.log(`  recall     ${pct(report.recall)}  (>= ${pct(DEFAULT_THRESHOLDS.recall)})  ${mark(report.pass.recall)}`);
  console.log(`  citation   ${pct(report.citationPrecision)}  (>= ${pct(DEFAULT_THRESHOLDS.citation)})  ${mark(report.pass.citation)}`);

  if (report.matches.length > 0) {
    console.log("\n  matched:");
    for (const match of report.matches) {
      console.log(`    "${match.produced}"  ~  "${match.expected}"  (${match.sharedFiles} shared files)`);
    }
  }
  if (report.falsePositives.length > 0) {
    console.log("\n  false positives (produced, no ground-truth match):");
    for (const name of report.falsePositives) {
      console.log(`    + ${name}`);
    }
  }
  if (report.missed.length > 0) {
    console.log("\n  missed (expected, not produced):");
    for (const name of report.missed) {
      console.log(`    - ${name}`);
    }
  }

  console.log(`\n  OVERALL: ${mark(report.pass.overall)}`);
  console.log("  (legibility is judged by hand — not auto-scored)");
  process.exit(report.pass.overall ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(2);
});
