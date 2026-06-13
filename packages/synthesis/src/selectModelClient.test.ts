import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelHost, selectModelClient } from "./selectModelClient.js";

const present = (): boolean => true;
const absent = (): boolean => false;

test("precedence: --host flag beats MAPPAMIND_MODEL beats the default", () => {
  assert.equal(resolveModelHost("codex", { MAPPAMIND_MODEL: "claude" }), "codex");
  assert.equal(resolveModelHost(undefined, { MAPPAMIND_MODEL: "codex" }), "codex");
  assert.equal(resolveModelHost(undefined, {}), "claude");
});

test("resolveModelHost trims and is case-insensitive", () => {
  assert.equal(resolveModelHost("  CODEX ", {}), "codex");
});

test("unknown host throws a named, actionable error", () => {
  assert.throws(() => resolveModelHost("gpt", {}), /Unknown model host "gpt".*--host claude or --host codex/s);
});

test("selectModelClient returns a working client when the chosen CLI is present", () => {
  const client = selectModelClient({ host: "codex", env: {}, hasBinary: present });
  assert.equal(typeof client.complete, "function");
});

test("selectModelClient throws a named error pointing at the fix when the CLI is missing", () => {
  assert.throws(
    () => selectModelClient({ host: "codex", env: {}, hasBinary: absent }),
    /The "codex" model CLI \("codex"\) was not found on PATH.*--host claude/s
  );
});

test("default path selects claude when neither flag nor env is set (regression)", () => {
  let asked = "";
  selectModelClient({
    env: {},
    hasBinary: (name) => {
      asked = name;
      return true;
    }
  });
  assert.equal(asked, "claude", "no host + no env must resolve to claude, never codex");
});
