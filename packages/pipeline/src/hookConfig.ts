import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AgentHookTarget = "all" | "claude" | "codex";

export type CommandHook = {
  readonly type: "command";
  readonly command: string;
  readonly statusMessage?: string;
  readonly timeout?: number;
};

export type HookKind = "snapshot" | "shift";
export type HookHost = "claude" | "codex";

const ROOT_ARG = '"$(git rev-parse --show-toplevel 2>/dev/null || pwd)"';

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export type HookCommandSpec = {
  readonly kind: HookKind;
  readonly host?: HookHost | undefined; // --host, on shift only; snapshot never makes a model call
  readonly hook?: boolean | undefined; // --hook: Codex Stop JSON-stdout mode
  readonly binPath?: string | undefined; // absolute path (nvm-proof install); else bare "mappamind"
  readonly guard?: boolean | undefined; // wrap with an availability guard + a calm fix hint
};

// THE single source of truth for every hook command string. Bare or absolute,
// guarded or not, with or without --host/--hook — all variants derive from here,
// so the installer, the static plugin files, and the printed config can never
// drift apart (the drift class that broke Codex Stop hooks once already; see the
// `hook-template-drift` learning). A CI test (genPluginHooks.test.ts) asserts the
// committed plugin files equal this builder's output.
export function hookCommand(spec: HookCommandSpec): string {
  const bin = spec.binPath ? quote(spec.binPath) : "mappamind";
  const parts = [bin, spec.kind, ROOT_ARG];
  if (spec.kind === "shift") {
    if (spec.hook) parts.push("--hook");
    if (spec.host) parts.push("--host", spec.host);
  }
  const cmd = parts.join(" ");
  if (!spec.guard) return cmd;
  // Guard. Missing binary → one calm message on stderr (JSON-safe on the Codex
  // Stop path, which reserves stdout for JSON) naming the fix, never a raw error
  // every session end. if/then/else (not `&&`/`||`) so a real shift failure keeps
  // its own exit code instead of printing the misleading "not found" hint.
  const check = spec.binPath ? `[ -x ${quote(spec.binPath)} ]` : "command -v mappamind >/dev/null 2>&1";
  const hint = spec.binPath
    ? `mappamind not found at ${spec.binPath}: rerun 'mappamind hooks --install' or remove this hook`
    : "mappamind not found on PATH: run 'npm i -g mappamind' or remove this hook";
  return `if ${check}; then ${cmd}; else echo ${quote(hint)} >&2; fi`;
}

function snapshotHook(binPath?: string, codex = false): CommandHook {
  const command = hookCommand({ kind: "snapshot", guard: true, ...(binPath ? { binPath } : {}) });
  return codex
    ? { type: "command", command, statusMessage: "Mappamind: recording the before snapshot", timeout: 600 }
    : { type: "command", command };
}

function shiftHook(host: HookHost, binPath?: string): CommandHook {
  const codex = host === "codex";
  const command = hookCommand({
    kind: "shift",
    host,
    guard: true,
    ...(codex ? { hook: true } : {}),
    ...(binPath ? { binPath } : {})
  });
  return codex
    ? { type: "command", command, statusMessage: "Mappamind: rendering the shift card", timeout: 600 }
    : { type: "command", command };
}

// Claude hooks: SessionStart snapshot (no --host, no model call), Stop shift with
// --host claude. binPath set → nvm-proof absolute command; omitted → bare + guard
// (what the static plugin file and a manual install use).
export function claudeHooksConfig(binPath?: string): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [{ hooks: [snapshotHook(binPath, false)] }],
      Stop: [{ hooks: [shiftHook("claude", binPath)] }]
    }
  };
}

// Codex hooks: same shape, but the Stop shift runs --hook (JSON stdout) and both
// carry statusMessage/timeout. SessionStart still has NO --host (snapshot makes no
// model call, so it must never fail for a missing model CLI).
export function codexHooksConfig(binPath?: string): Record<string, unknown> {
  return {
    hooks: {
      SessionStart: [{ matcher: "startup|resume", hooks: [snapshotHook(binPath, true)] }],
      Stop: [{ hooks: [shiftHook("codex", binPath)] }]
    }
  };
}

// A hook is "ours" if its command mentions mappamind and the subcommand word —
// robust across every variant (bare, guarded, absolute-path), which a literal
// command prefix is not (the guard/absolute forms don't start with "mappamind").
// Exported so the status check (onboarding.ts) shares it: upsert, remove, and
// status can never disagree about what counts as our hook.
export function isMappamindHook(candidate: unknown, sub: HookKind): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const command = (candidate as { command?: unknown }).command;
  return typeof command === "string" && command.includes("mappamind") && new RegExp(`\\b${sub}\\b`).test(command);
}

export function upsertCommandHook(
  entries: readonly unknown[],
  hook: CommandHook,
  sub: HookKind,
  newGroup: Record<string, unknown> = { hooks: [hook] }
): unknown[] {
  let found = false;
  const next = entries.map((entry) => {
    if (typeof entry !== "object" || entry === null || !Array.isArray((entry as { hooks?: unknown }).hooks)) {
      return entry;
    }
    const group = entry as Record<string, unknown> & { hooks: unknown[] };
    const hooks = group.hooks.map((candidate) => {
      if (isMappamindHook(candidate, sub)) {
        found = true;
        return hook;
      }
      return candidate;
    });
    return { ...group, hooks };
  });
  return found ? next : [...next, newGroup];
}

export function removeCommandHook(entries: readonly unknown[], sub: HookKind): unknown[] {
  const next: unknown[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null || !Array.isArray((entry as { hooks?: unknown }).hooks)) {
      next.push(entry);
      continue;
    }
    const group = entry as Record<string, unknown> & { hooks: unknown[] };
    const hooks = group.hooks.filter((candidate) => !isMappamindHook(candidate, sub));
    if (hooks.length > 0) {
      next.push({ ...group, hooks });
    }
  }
  return next;
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function installClaudeHooks(root: string, binPath?: string): Promise<string> {
  const path = join(root, ".claude", "settings.json");
  const settings = await readJsonObject(path);
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  hooks["SessionStart"] = upsertCommandHook(hooks["SessionStart"] ?? [], snapshotHook(binPath, false), "snapshot");
  hooks["Stop"] = upsertCommandHook(hooks["Stop"] ?? [], shiftHook("claude", binPath), "shift");
  settings["hooks"] = hooks;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return path;
}

function assignHookEntries(hooks: Record<string, unknown[]>, event: string, entries: unknown[]): void {
  if (entries.length > 0) {
    hooks[event] = entries;
  } else {
    delete hooks[event];
  }
}

export async function removeClaudeHooks(root: string): Promise<string> {
  const path = join(root, ".claude", "settings.json");
  // Nothing to remove and nothing was ever written — don't create an empty file.
  if (!existsSync(path)) {
    return path;
  }
  const settings = await readJsonObject(path);
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  assignHookEntries(hooks, "SessionStart", removeCommandHook(hooks["SessionStart"] ?? [], "snapshot"));
  assignHookEntries(hooks, "Stop", removeCommandHook(hooks["Stop"] ?? [], "shift"));
  settings["hooks"] = hooks;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return path;
}

export async function installCodexHooks(root: string, binPath?: string): Promise<string> {
  const path = join(root, ".codex", "hooks.json");
  const settings = await readJsonObject(path);
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  const snapshot = snapshotHook(binPath, true);
  hooks["SessionStart"] = upsertCommandHook(hooks["SessionStart"] ?? [], snapshot, "snapshot", {
    matcher: "startup|resume",
    hooks: [snapshot]
  });
  hooks["Stop"] = upsertCommandHook(hooks["Stop"] ?? [], shiftHook("codex", binPath), "shift");
  settings["hooks"] = hooks;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return path;
}

export async function removeCodexHooks(root: string): Promise<string> {
  const path = join(root, ".codex", "hooks.json");
  // Nothing to remove and nothing was ever written — don't create an empty file.
  if (!existsSync(path)) {
    return path;
  }
  const settings = await readJsonObject(path);
  const hooks = (settings["hooks"] ?? {}) as Record<string, unknown[]>;
  assignHookEntries(hooks, "SessionStart", removeCommandHook(hooks["SessionStart"] ?? [], "snapshot"));
  assignHookEntries(hooks, "Stop", removeCommandHook(hooks["Stop"] ?? [], "shift"));
  settings["hooks"] = hooks;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return path;
}
