import assert from "node:assert/strict";
import test from "node:test";

import { LARGE_REPO_WARN_FILES, largeRepoAdvisory } from "./collect.js";

test("largeRepoAdvisory: stays silent below the threshold", () => {
  assert.equal(largeRepoAdvisory(0), null);
  assert.equal(largeRepoAdvisory(LARGE_REPO_WARN_FILES - 1), null);
});

test("largeRepoAdvisory: warns at/above the threshold, naming the file count", () => {
  const note = largeRepoAdvisory(LARGE_REPO_WARN_FILES);
  assert.ok(note, "expected an advisory at the threshold");
  assert.match(note!, new RegExp(`${LARGE_REPO_WARN_FILES} files`));
  // Honest about the v0.1 limitation and the fast-follow, no false promise of speed.
  assert.match(note!, /Incremental capture is coming/);
});
