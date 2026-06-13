import assert from "node:assert/strict";
import test from "node:test";

import { extractAgentMessage } from "./codexClient.js";

// A REAL `codex exec --json` event stream, captured verbatim from codex-cli
// 0.139.0. The answer is interleaved with thread/turn lifecycle events — the
// exact failure mode the eng review flagged. extractAgentMessage must recover
// only the agent's final message.
const REAL_STREAM = [
  `{"type":"thread.started","thread_id":"019eb2fa-9a34-7501-a4fb-b1e673a3f012"}`,
  `{"type":"turn.started"}`,
  `{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"{\\"ok\\":true,\\"answer\\":\\"mappamind\\"}"}}`,
  `{"type":"turn.completed","usage":{"input_tokens":23552,"cached_input_tokens":6016,"output_tokens":41,"reasoning_output_tokens":23}}`
].join("\n");

test("extractAgentMessage pulls the clean answer out of a real interleaved stream", () => {
  assert.equal(extractAgentMessage(REAL_STREAM), `{"ok":true,"answer":"mappamind"}`);
});

test("extractAgentMessage takes the LAST agent_message across multiple turns", () => {
  const stream = [
    `{"type":"item.completed","item":{"type":"agent_message","text":"first"}}`,
    `{"type":"turn.started"}`,
    `{"type":"item.completed","item":{"type":"agent_message","text":"second"}}`
  ].join("\n");
  assert.equal(extractAgentMessage(stream), "second");
});

test("extractAgentMessage tolerates non-JSON progress noise between events", () => {
  const stream = [
    `Reading prompt from stdin...`,
    `{"type":"turn.started"}`,
    `[2026-06-11T00:00:00Z] thinking`,
    `{"type":"item.completed","item":{"type":"agent_message","text":"clean"}}`
  ].join("\n");
  assert.equal(extractAgentMessage(stream), "clean");
});

test("extractAgentMessage returns undefined when no agent message is present", () => {
  // The client turns this into a NAMED error instead of feeding the leash garbage.
  const stream = [`{"type":"thread.started"}`, `{"type":"turn.completed","usage":{}}`].join("\n");
  assert.equal(extractAgentMessage(stream), undefined);
});

test("extractAgentMessage returns undefined on fully unparseable output", () => {
  assert.equal(extractAgentMessage("command not found: codex\nbye\n"), undefined);
});
