// The `claude -p` adapter: the default ModelClient.
//
// Reuses the host's Claude (no API key — D3). Prompt goes in on stdin (no arg-length
// limit); output is read from stdout. Determinism is the intent (temp 0, fixed
// prompt) but is ultimately bounded by the host; standalone scoring should inject a
// pinned API client instead (spec Point 3a). This adapter shells out and nothing
// more — all grounding happens after, in the leash.

import { spawn } from "node:child_process";

import type { ModelClient, ModelRequest, ModelResponse } from "./model.js";

export type ClaudeCliOptions = {
  readonly binary?: string; // default "claude"
  readonly model?: string; // passed as --model when set
  readonly extraArgs?: readonly string[]; // e.g. pin settings; appended verbatim
  readonly timeoutMs?: number; // default 120_000
};

function runClaude(input: string, options: ClaudeCliOptions): Promise<string> {
  const binary = options.binary ?? "claude";
  const args = ["-p", ...(options.model ? ["--model", options.model] : []), ...(options.extraArgs ?? [])];

  return new Promise<string>((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude -p timed out after ${options.timeoutMs ?? 120_000}ms`));
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
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`claude -p exited ${code}: ${stderr.trim() || "no stderr"}`));
      }
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

export function createClaudeCliClient(options: ClaudeCliOptions = {}): ModelClient {
  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      // `-p` takes a single prompt; fold the system instruction in as a leading block.
      const input = request.system ? `${request.system}\n\n${request.prompt}` : request.prompt;
      const text = await runClaude(input, options);
      return { text };
    }
  };
}
