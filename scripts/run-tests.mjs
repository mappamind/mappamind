// Compile-then-run test harness: finds every dist/**/*.test.js under packages/
// and runs them with node --test. Run `npm run build` first (npm test does).
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

async function findTests(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const tests = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      tests.push(...(await findTests(path)));
      continue;
    }
    if (entry.isFile() && path.endsWith(".test.js") && path.includes(`${join("dist")}/`)) {
      tests.push(path);
    }
  }
  return tests;
}

const tests = [];
for (const root of ["packages"]) {
  tests.push(...(await findTests(root)));
}
tests.sort();

if (tests.length === 0) {
  console.error("No compiled tests found. Run npm run build first.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...tests], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Test runner exited from signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
