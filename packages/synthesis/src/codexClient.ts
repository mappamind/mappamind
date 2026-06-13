// The `codex exec` adapter: a second ModelClient, for hosts running OpenAI Codex.
//
// Unlike `claude -p` (which writes a clean answer to stdout), `codex exec`
// interleaves thread/turn lifecycle with the answer. We run it with `--json`,
// which prints one JSON event per line, and extract ONLY the agent's final
// message — the last `item.completed` event whose `item.type` is
// `"agent_message"`. That extracted text is what the leash sees; the raw
// interleaved stream never reaches JSON parsing. On any failure (non-zero exit,
// or no agent message at all) we throw a NAMED error rather than hand garbage
// downstream.
//
// Real event stream (captured from codex-cli 0.139.0, see codexClient.test.ts):
//   {"type":"thread.started","thread_id":"..."}
//   {"type":"turn.started"}
//   {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"<answer>"}}
//   {"type":"turn.completed","usage":{...}}

import { spawn } from "node:child_process";

import type { ModelClient, ModelRequest, ModelResponse } from "./model.js";

export type CodexCliOptions = {
  readonly binary?: string; // default "codex"
  readonly model?: string; // passed as -m when set
  readonly extraArgs?: readonly string[]; // appended verbatim
  readonly timeoutMs?: number; // default 120_000
};

// Pull the final agent message out of a `codex exec --json` event stream.
// Returns undefined when the stream carries no agent message (the caller turns
// that into a named error). Tolerant of non-JSON noise: such lines are skipped.
export function extractAgentMessage(stdout: string): string | undefined {
  let last: string | undefined;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let evt: unknown;
    try {
      evt = JSON.parse(trimmed);
    } catch {
      continue; // progress/log noise, not an event — skip it
    }
    if (
      typeof evt === "object" &&
      evt !== null &&
      (evt as { type?: unknown }).type === "item.completed"
    ) {
      const item = (evt as { item?: { type?: unknown; text?: unknown } }).item;
      if (item && item.type === "agent_message" && typeof item.text === "string") {
        last = item.text;
      }
    }
  }
  return last;
}

function runCodex(input: string, options: CodexCliOptions): Promise<string> {
  const binary = options.binary ?? "codex";
  // `-` reads the prompt from stdin (no arg-length limit); `--json` gives the
  // structured event stream; read-only keeps the agent from touching the repo.
  const args = [
    "exec",
    "-",
    "--json",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    ...(options.model ? ["-m", options.model] : []),
    ...(options.extraArgs ?? [])
  ];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`codex exec timed out after ${options.timeoutMs ?? 120_000}ms`));
    }, options.timeoutMs ?? 120_000);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`codex exec exited ${code}: ${stderr.trim() || "no stderr"}`));
        return;
      }
      const text = extractAgentMessage(stdout);
      if (text === undefined) {
        const head = stdout.slice(0, 200).replace(/\n/g, "\\n");
        reject(new Error(`codex exec produced no agent message; stdout began: ${head || "(empty)"}`));
        return;
      }
      resolve(text);
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export function createCodexCliClient(options: CodexCliOptions = {}): ModelClient {
  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      const input = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
      const text = await runCodex(input, options);
      return { text };
    }
  };
}
