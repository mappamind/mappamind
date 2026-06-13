import assert from "node:assert/strict";
import test from "node:test";

import { createRepoId } from "./repoIdentity.js";

test("createRepoId is stable for the same root and remote", () => {
  const first = createRepoId("/tmp/mappamind-example", "git@github.com:example/app.git");
  const second = createRepoId("/tmp/mappamind-example", "git@github.com:example/app.git");

  assert.equal(first, second);
  assert.match(first, /^repo_[a-f0-9]{16}$/);
});

test("createRepoId changes when remote identity changes", () => {
  const first = createRepoId("/tmp/mappamind-example", "git@github.com:example/app.git");
  const second = createRepoId("/tmp/mappamind-example", "git@github.com:example/other.git");

  assert.notEqual(first, second);
});
