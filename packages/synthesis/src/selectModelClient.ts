// The single place that decides which model CLI backs the leash.
//
// Precedence: the explicit `--host` flag beats the MAPPAMIND_MODEL env var beats
// the default ("claude"). The chosen CLI must be on PATH; if it is not, we throw
// ONE named error telling the user exactly what to install or how to switch
// hosts — never a silent fallback to the other CLI (a silent fallback would hide
// a broken hook install and narrate with a model the user didn't choose).
//
// All call sites (shift, setup, watch, baseline) go through here so the
// precedence rule and the missing-CLI message live in exactly one place.

import { spawnSync } from "node:child_process";

import { createClaudeCliClient } from "./claudeClient.js";
import { createCodexCliClient } from "./codexClient.js";
import type { ModelClient } from "./model.js";

export type ModelHost = "claude" | "codex";

export type SelectModelOptions = {
  readonly host?: string | undefined; // from --host (highest precedence)
  readonly env?: NodeJS.ProcessEnv; // defaults to process.env
  readonly timeoutMs?: number; // passed to the chosen client
  readonly hasBinary?: (name: string) => boolean; // injectable for tests
};

function defaultHasBinary(name: string): boolean {
  try {
    const result = spawnSync(name, ["--version"], { stdio: "ignore", timeout: 5000 });
    return !result.error; // ENOENT sets result.error; a real binary does not
  } catch {
    return false;
  }
}

// Resolve the host string with precedence (flag > env > default). Exported so the
// precedence rule itself is unit-testable without spawning anything.
export function resolveModelHost(
  host: string | undefined,
  env: NodeJS.ProcessEnv = process.env
): ModelHost {
  const raw = (host ?? env.MAPPAMIND_MODEL ?? "claude").trim().toLowerCase();
  if (raw === "claude" || raw === "codex") return raw;
  throw new Error(
    `Unknown model host "${raw}". Use --host claude or --host codex (or set MAPPAMIND_MODEL=claude|codex).`
  );
}

export function selectModelClient(options: SelectModelOptions = {}): ModelClient {
  const env = options.env ?? process.env;
  const host = resolveModelHost(options.host, env);
  const binary = host === "codex" ? "codex" : "claude";
  const has = options.hasBinary ?? defaultHasBinary;

  if (!has(binary)) {
    const other = host === "codex" ? "claude" : "codex";
    throw new Error(
      `The "${host}" model CLI ("${binary}") was not found on PATH. ` +
        `Install it, or select the other host with --host ${other} or MAPPAMIND_MODEL=${other}.`
    );
  }

  const clientOptions = options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs };
  return host === "codex" ? createCodexCliClient(clientOptions) : createClaudeCliClient(clientOptions);
}
