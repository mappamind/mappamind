// Pack-smoke: prove the published graph actually installs and runs, without
// touching the registry. It (1) pins every public package to one smoke version with
// internal deps locked to it (the same lockstep publish.mjs does), (2) `npm pack`s
// all public packages, (3) installs every tarball together into a throwaway project, and
// (4) runs the installed `mappamind` bin. This catches the classic post-publish
// breakage — a wrong files whitelist, a missing dep, a wasm path that doesn't
// resolve once the workspace symlinks are gone — before a real publish.
//
// Mutates packages/*/package.json in place (versions/deps) and always restores
// them in a finally. Run: `node scripts/pack-smoke.mjs`
//
// `--global` mode: instead of installing the tarballs LOCALLY into a consumer
// project, install all public tarballs GLOBALLY in one command (`npm install -g <all .tgz>`),
// which links the wrapper's `mappamind` bin into the global prefix. It then runs
// the global bin against a git fixture to prove the global bin shim / PATH
// resolution / hook registration work on macOS + Linux (strengthening bundle d).

import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GLOBAL = process.argv.includes("--global");
const SMOKE_VERSION = "0.0.0-smoke";
const originals = new Map(); // path -> original text (for restore)
const staging = mkdtempSync(join(tmpdir(), "mappamind-pack-"));
const consumer = mkdtempSync(join(tmpdir(), "mappamind-smoke-"));
let restored = false;

function loadPackages() {
  const pkgs = new Map();
  const privatePackageNames = new Set();
  for (const dir of readdirSync("packages")) {
    const path = `packages/${dir}/package.json`;
    let text;
    try {
      text = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    const json = JSON.parse(text);
    if (!json.name) continue;
    if (json.private === true) {
      privatePackageNames.add(json.name);
      continue;
    }
    originals.set(path, text);
    pkgs.set(json.name, { dir, path, json });
  }
  for (const { json } of pkgs.values()) {
    for (const field of ["dependencies", "peerDependencies"]) {
      for (const dep of Object.keys(json[field] ?? {})) {
        if (privatePackageNames.has(dep)) {
          throw new Error(`${json.name} depends on private package ${dep}; public packages cannot publish with private deps.`);
        }
      }
    }
  }
  return pkgs;
}

function restore() {
  if (restored) return;
  restored = true;
  for (const [path, text] of originals) writeFileSync(path, text);
  rmSync(staging, { recursive: true, force: true });
  rmSync(consumer, { recursive: true, force: true });
}

function restoreAndExit(signal) {
  restore();
  console.error(`pack-smoke interrupted by ${signal}; restored package manifests.`);
  process.exit(130);
}

process.once("SIGINT", restoreAndExit);
process.once("SIGTERM", restoreAndExit);

// Make the consumer a real git repo so `status`/`snapshot`/`shift` have
// something to discover. Shared by the local and global paths.
function makeGitFixture() {
  writeFileSync(join(consumer, "index.js"), "export const smoke = 1;\n");
  execSync(
    "git init -q && git add index.js && git -c user.email=s@smoke.test -c user.name=smoke commit -q -m smoke",
    { cwd: consumer, shell: "/bin/bash" }
  );
}

// Exercise the installed bin end to end against the git fixture. `bin` is an
// absolute path to the `mappamind` executable (local .bin shim or global shim).
// status makes no model call; shift runs with --no-model.
function runInstalledBin(bin) {
  const output = execSync(`"${bin}" status "${consumer}"`, { cwd: consumer }).toString();
  if (!/mappamind|baseline|workspace|repo/i.test(output)) {
    throw new Error(`pack-smoke: unexpected status output:\n${output}`);
  }
  // Hook registration + a hook run, no model: install hooks, snapshot the BEFORE,
  // then run shift on an unchanged tree (folds cosmetic, never calls a model CLI).
  execSync(`"${bin}" hooks --install`, { cwd: consumer, stdio: "ignore" });
  execSync(`"${bin}" snapshot "${consumer}"`, { cwd: consumer, stdio: "ignore" });
  execSync(`"${bin}" shift "${consumer}" --no-model --quiet`, { cwd: consumer, stdio: "ignore" });
}

try {
  const pkgs = loadPackages();

  // Lockstep version + internal dep pinning (mirrors publish.mjs).
  for (const { path, json } of pkgs.values()) {
    json.version = SMOKE_VERSION;
    for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
      const deps = json[field];
      if (!deps) continue;
      for (const dep of Object.keys(deps)) if (pkgs.has(dep)) deps[dep] = SMOKE_VERSION;
    }
    writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  }

  // Pack every package into the staging dir.
  const tarballs = [];
  for (const { dir } of pkgs.values()) {
    const out = execSync(`npm pack --pack-destination "${staging}"`, { cwd: `packages/${dir}` })
      .toString()
      .trim()
      .split("\n")
      .pop()
      .trim();
    tarballs.push(resolve(staging, out));
  }

  const tarballArgs = tarballs.map((t) => `"${t}"`).join(" ");

  if (GLOBAL) {
    // Install ALL 12 tarballs globally in one command. Matching versions + every
    // tarball present means npm resolves the internal graph offline and links the
    // wrapper's `mappamind` bin into the global prefix.
    execSync(`npm install -g --no-audit --no-fund ${tarballArgs}`, { stdio: "inherit" });

    // Locate the global bin dir so we call the shim by absolute path — no reliance
    // on the runner's PATH already containing the npm global prefix.
    const globalBin = execSync("npm prefix -g").toString().trim();
    const binName = process.platform === "win32" ? "mappamind.cmd" : "mappamind";
    const bin = join(globalBin, process.platform === "win32" ? "" : "bin", binName);

    makeGitFixture();
    runInstalledBin(bin);

    console.log(
      `pack-smoke OK (--global): ${tarballs.length} packages packed + installed globally; the global mappamind bin (${bin}) ran status, hooks --install, snapshot, and a no-model shift.`
    );
  } else {
    // Install every tarball together into a clean consumer project. With matching
    // versions and all tarballs present, npm resolves the internal graph offline.
    writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "smoke", private: true }, null, 2));
    execSync(`npm install --no-audit --no-fund ${tarballArgs}`, {
      cwd: consumer,
      stdio: "inherit"
    });

    makeGitFixture();

    // Run the installed bin end to end via the local .bin shim.
    const bin = join(consumer, "node_modules", ".bin", "mappamind");
    runInstalledBin(bin);

    console.log(
      `pack-smoke OK: ${tarballs.length} packages packed + installed; status, hooks --install, snapshot, and a no-model shift all ran from a clean install.`
    );
  }
} finally {
  restore();
}
