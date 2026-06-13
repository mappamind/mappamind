#!/usr/bin/env node
// Score produced cross-service channels against a hand-labeled fixture. Usage:
//   mappamind-score-channels <produced-edges.json> <channel-truth.json> [candidate-pairs.json]
// produced-edges.json: ProducedChannelEdge[]  ·  channel-truth.json: ChannelGroundTruth
// candidate-pairs.json (optional): string[] of "a|b" unordered pairs from the surfacer,
// so candidate-stage recall (the surfacer ceiling) is reported separately.
// Truth/candidate paths are intentionally external — keep held-out labels out of git.

import { readFile } from "node:fs/promises";

import { scoreChannels, type ProducedChannelEdge } from "./channelScore.js";
import { validateChannelGroundTruth } from "./channelTruth.js";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function mark(passed: boolean): string {
  return passed ? "PASS" : "FAIL";
}

async function main(): Promise<void> {
  const [producedPath, truthPath, candidatePath] = process.argv.slice(2);
  if (!producedPath || !truthPath) {
    console.error("usage: mappamind-score-channels <produced-edges.json> <channel-truth.json> [candidate-pairs.json]");
    process.exit(2);
  }

  const produced = JSON.parse(await readFile(producedPath, "utf8")) as ProducedChannelEdge[];
  const truth = validateChannelGroundTruth(JSON.parse(await readFile(truthPath, "utf8")));
  const candidatePairs = candidatePath
    ? (JSON.parse(await readFile(candidatePath, "utf8")) as string[])
    : undefined;

  const report = scoreChannels(produced, truth, candidatePairs ? { candidatePairs } : {});

  console.log(`\n=== CHANNELS: ${report.label} ===`);
  console.log(`  produced ${report.producedCount} edges, expected ${report.expectedCount}, matched ${report.matchedCount}`);
  console.log(`  precision        ${pct(report.precision)}  ${mark(report.pass.precision)}`);
  console.log(`  recall           ${pct(report.recall)}  ${mark(report.pass.recall)}`);
  if (report.candidateRecall !== null) {
    console.log(`  candidate recall ${pct(report.candidateRecall)}  (surfacer ceiling)`);
  }
  console.log(
    `  poison-pill rate ${pct(report.poisonPillRate)}  ${mark(report.pass.poisonPill)}` +
      `  (${report.poisonPillCount}/${report.verifiedCount} verified: ${report.falseVerified} false, ${report.wrongDirection} reversed, ${report.wrongKind} wrong-kind)`
  );
  if (report.missed.length > 0) {
    console.log("\n  missed (expected, not produced):");
    for (const m of report.missed) console.log(`    - ${m}`);
  }
  console.log(`\n  OVERALL: ${mark(report.pass.overall)}`);
  process.exit(report.pass.overall ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(2);
});
