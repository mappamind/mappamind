// Lockstep publisher for the Mappamind workspace.
//
// Every public @mappamind_/* package plus the thin `mappamind` wrapper publishes
// at ONE shared version. Private workspace packages are kept for internal tools
// and tests, but are never packed or uploaded. This script (1) sets every public
// package version to <version> and
// rewrites every internal @mappamind_/* dependency range to the same exact
// version, then (2) publishes in dependency (topological) order so a package is
// only published after the packages it depends on — otherwise the wrapper would
// resolve to a version that isn't on the registry yet and install broken.
//
// Run from CI on a version tag (see .github/workflows/publish.yml), after a
// successful build. --provenance requires CI OIDC, so locally use --dry-run.
//
//   node scripts/publish.mjs 0.1.0            # real publish (CI only)
//   node scripts/publish.mjs 0.1.0 --dry-run  # pack + validate, no upload

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const version = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

if (!version || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(version)) {
  console.error("usage: node scripts/publish.mjs <semver> [--dry-run]");
  process.exit(2);
}

// Load every public workspace package.json. Private packages can depend on public
// packages for tests/evals, but public packages must not depend on private ones.
const pkgs = new Map(); // name -> { dir, path, json }
const privatePackageNames = new Set();
for (const dir of readdirSync("packages")) {
  const path = `packages/${dir}/package.json`;
  let json;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    continue;
  }
  if (!json.name) continue;
  if (json.private === true) {
    privatePackageNames.add(json.name);
    continue;
  }
  pkgs.set(json.name, { dir, path, json });
}

// 1. Lockstep: one version everywhere; internal dep ranges pinned to it.
for (const { path, json } of pkgs.values()) {
  json.version = version;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const deps = json[field];
    if (!deps) continue;
    for (const dep of Object.keys(deps)) {
      if (pkgs.has(dep)) deps[dep] = version;
    }
  }
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
}

// 2. Topological order: dependencies before dependents.
const order = [];
const seen = new Set();
function visit(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const deps = pkgs.get(name).json.dependencies ?? {};
  for (const dep of Object.keys(deps)) {
    if (privatePackageNames.has(dep)) {
      throw new Error(`${name} depends on private package ${dep}; public packages cannot publish with private deps.`);
    }
    if (pkgs.has(dep)) visit(dep);
  }
  order.push(name);
}
for (const name of pkgs.keys()) visit(name);

// 3. Publish in order.
console.log(`Publishing ${order.length} packages @ ${version}${dryRun ? " (dry run)" : ""}`);
for (const name of order) {
  const { dir } = pkgs.get(name);
  const flags = ["--access public", ...(dryRun ? ["--dry-run"] : ["--provenance"])].join(" ");
  console.log(`-> ${name}`);
  execSync(`npm publish ${flags}`, { cwd: `packages/${dir}`, stdio: "inherit" });
}
