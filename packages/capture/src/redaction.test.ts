import assert from "node:assert/strict";
import test from "node:test";

import { redactJsonValue, redactText } from "./redaction.js";

test("redactText redacts obvious secret assignments while preserving keys", () => {
  const input = [
    "OPENAI_API_KEY=sk-testsecret12345678901234567890",
    "client_secret: super-secret-value",
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456"
  ].join("\n");

  const redacted = redactText(input);

  assert.equal(redacted.redactionState, "redacted");
  assert.equal(redacted.redactionCount, 3);
  assert.match(redacted.value, /OPENAI_API_KEY=\[REDACTED_SECRET\]/);
  assert.match(redacted.value, /client_secret: \[REDACTED_SECRET\]/);
  assert.match(redacted.value, /Authorization: Bearer \[REDACTED_SECRET\]/);
  assert.doesNotMatch(redacted.value, /sk-testsecret/);
  assert.doesNotMatch(redacted.value, /super-secret-value/);
  assert.doesNotMatch(redacted.value, /abcdefghijklmnopqrstuvwxyz123456/);
});

test("redactJsonValue redacts nested text without dropping evidence structure", () => {
  const redacted = redactJsonValue({
    gitRoot: "/tmp/repo",
    files: [
      {
        path: "src/config.ts",
        bytes: 88,
        text: 'export const token = {"github_pat":"github_pat_1234567890abcdefghijklmnopqrstuvwxyz"};'
      }
    ],
    stagedDiff: "+const password = 'correct-horse-battery-staple'\n"
  });

  assert.equal(redacted.redactionState, "redacted");
  assert.equal(redacted.redactionCount, 2);
  assert.deepEqual(
    redacted.value,
    {
      gitRoot: "/tmp/repo",
      files: [
        {
          path: "src/config.ts",
          bytes: 88,
          text: 'export const token = {"github_pat":"[REDACTED_SECRET]"};'
        }
      ],
      stagedDiff: "+const password = '[REDACTED_SECRET]'\n"
    }
  );
});
