#!/usr/bin/env node
// mappamind — the accept-moment CLI (Phase 2d).
//
//   mappamind snapshot [root]                 SessionStart hook: record the BEFORE
//   mappamind shift [root] [--no-model] [--out file] [--quiet] [--open] [--hook]
//                                             Stop hook: the before/after card
//                                             (--hook: human text to stderr, one
//                                              JSON object to stdout for Codex/Claude)
//   mappamind hooks [root] [--install] [--agent all|claude|codex]
//                                             Claude Code + Codex hook config
//   mappamind status [root] [--json]          first-run/baseline state
//   mappamind setup [root] --host claude|codex [--yes] [--force]
//                                             guided initial baseline + Studio
//   mappamind baseline <root...>              full grounded baseline summary
//   mappamind watch [root] [--interval s] [--no-model]
//                                             solo-human mode: same pipe, polled

import { stdin as processStdin, stderr as processStderr, stdout as processStdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { selectModelClient } from "@mappamind_/synthesis";
import type { ModelClient } from "@mappamind_/synthesis";

import {
  claudeHooksConfig,
  codexHooksConfig,
  installClaudeHooks,
  installCodexHooks,
  removeClaudeHooks,
  removeCodexHooks,
  type AgentHookTarget
} from "./hookConfig.js";
import { largeRepoAdvisory } from "./collect.js";
import { fileUrlForPath, maybeOpenShiftCard, runShift, takeSnapshot } from "./shift.js";
import type { ShiftOutcome } from "./shift.js";
import { getMappamindStatus, runSetup } from "./onboarding.js";
import type { MappamindStatus, SetupOutcome } from "./onboarding.js";

const deadClient: ModelClient = {
  complete: () => Promise.reject(new Error("model disabled (--no-model)"))
};

function flag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0 || index === args.length - 1) return undefined;
  const value = args[index + 1];
  args.splice(index, 2);
  return value;
}

function rootArg(args: string[]): string {
  return resolve(args.find((arg) => !arg.startsWith("-")) ?? ".");
}

// The absolute, nvm-proof path to this binary. Written into installed hooks so
// they keep resolving after an nvm switch drops the global bin dir from PATH;
// the guard still backstops a dangling path. realpath follows the bin symlink to
// the real dist file. undefined → installers fall back to the bare guarded form.
function resolveBinPath(): string | undefined {
  const entry = process.argv[1];
  if (!entry) return undefined;
  try {
    return realpathSync(entry);
  } catch {
    return resolve(entry);
  }
}

type CliProgress = {
  readonly progress: (message: string) => void;
  readonly stop: () => void;
};

function createCliProgress(heartbeatMs = processStderr.isTTY ? 10_000 : 30_000): CliProgress {
  let current = "";
  let startedAt = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stepLabel = (message: string): string => message.replace(/\.\.\.$/, "").trim();
  const heartbeat = (): void => {
    if (!current) return;
    const elapsed = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
    console.error(`mappamind: ${stepLabel(current)} still running (${elapsed}s elapsed)`);
  };

  return {
    progress(message) {
      current = message;
      startedAt = Date.now();
      console.error(`mappamind: ${message}`);
      if (!timer) {
        timer = setInterval(heartbeat, heartbeatMs);
        timer.unref?.();
      }
    },
    stop() {
      current = "";
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    }
  };
}

function reportShift(outcome: ShiftOutcome, log: (line: string) => void = console.log): void {
  const advisory = largeRepoAdvisory(outcome.filesSeen);
  if (outcome.folded) {
    const why =
      outcome.reason === "no-changes"
        ? "no files changed"
        : outcome.reason === "no-before"
          ? "no session snapshot and no git HEAD to diff against"
          : `cosmetic — ${outcome.changedPaths.length} file(s) changed, nothing downstream`;
    log(`mappamind: folded (${why})`);
    if (advisory) log(`  note: ${advisory}`);
    return;
  }
  const card = outcome.card!;
  const scope = outcome.repoLabels.length > 1 ? ` across ${outcome.repoLabels.length} repos` : "";
  log(`mappamind: ${card.severity.toUpperCase()} — ${card.title}`);
  log(
    `  changed ${outcome.changedPaths.length}${scope} · affected ${outcome.slice!.affectedFiles.length} · ` +
      `broken ${card.brokenContracts.length} · before=${outcome.beforeSource} · ` +
      `narration=${card.narrationSource} · model≈${Math.round(outcome.modelChars / 4)} tokens`
  );
  log(`  card: ${fileUrlForPath(outcome.htmlPath!)}`);
  if (advisory) log(`  note: ${advisory}`);
}

// The Stop-hook stdout contract. Codex parses a Stop hook's stdout as JSON when
// it exits 0 — plain text is a hard error ("invalid stop hook JSON output") —
// and Claude accepts the same shape. So in hook mode we emit ONE JSON object:
// a `systemMessage` (with the card URL) surfaces to the user without blocking
// the stop; a cosmetic/no-op fold stays silent with an empty object.
function shiftHookJson(outcome: ShiftOutcome): string {
  if (outcome.folded || !outcome.htmlPath || !outcome.card) {
    return JSON.stringify({});
  }
  const card = outcome.card;
  const message = `Mappamind: ${card.severity.toUpperCase()} — ${card.title}. Card: ${fileUrlForPath(outcome.htmlPath)}`;
  return JSON.stringify({ systemMessage: message });
}

function reportStatus(status: MappamindStatus): void {
  console.log(`mappamind: ${status.baseline.state} baseline for ${status.root}`);
  console.log(`  workspace: ${status.workspaceId} · ${status.repos.length} repo${status.repos.length === 1 ? "" : "s"} · ${status.filesExtracted}/${status.filesSeen} files extracted`);
  const advisory = largeRepoAdvisory(status.filesSeen);
  if (advisory) console.log(`  note: ${advisory}`);
  for (const repo of status.repos) {
    console.log(`  repo: ${repo.repo} -> ${repo.root}`);
  }
  console.log(`  baseline: ${status.baseline.path}`);
  if (status.baseline.warning) {
    console.log(`  warning: ${status.baseline.warning}`);
  }
  if (status.baseline.studioUrl) {
    console.log(`  studio: ${status.baseline.studioUrl}`);
  }
  for (const warning of status.hooks.warnings) {
    console.log(`  warning: ${warning}`);
  }
}

function reportSetup(outcome: SetupOutcome): void {
  if (outcome.ran) {
    // Only a previously-missing baseline is "created"; stale or forced-current
    // runs rebuild an existing one, so they read as "refreshed".
    console.log(`mappamind: baseline ${outcome.reason === "missing" ? "created" : "refreshed"}`);
    if (outcome.synthesis) {
      const s = outcome.synthesis;
      console.log(
        `  synthesis: ${s.capabilities} capabilities grounded · ${s.modelAttempts} attempted · ` +
          `${s.modelCalls} response${s.modelCalls === 1 ? "" : "s"} · ${s.droppedCapabilities} dropped`
      );
      for (const error of s.repoErrors) {
        console.log(`  warning: synthesis failed for ${error.repo}: ${error.error}`);
      }
      if (s.repoErrors.length > 0 && s.capabilities === 0) {
        console.log("  warning: baseline.json has no capabilities because model-backed synthesis did not produce grounded output");
      } else if (s.repoErrors.length === 0 && s.capabilities === 0) {
        console.log("  note: model-backed synthesis ran, but no proposed capabilities survived grounding");
      }
    }
    if (outcome.baselinePath) {
      console.log(`  baseline: ${outcome.baselinePath}`);
    }
    if (outcome.channelCachePath) {
      console.log(`  channels: ${outcome.channelCachePath}`);
    }
    if (outcome.studioUrl) {
      console.log(`  studio: ${outcome.studioUrl}`);
    }
    return;
  }
  if (outcome.reason === "current") {
    console.log("mappamind: baseline current");
    if (outcome.studioUrl) {
      console.log(`  studio: ${outcome.studioUrl}`);
    }
    return;
  }
  console.log("mappamind: setup skipped");
}

// Read stdin without ever blocking the shift (timeout-bounded). The Stop hook pipes
// a JSON payload here; an interactive run has none. Used only to find the transcript.
function readStdinText(timeoutMs = 1500): Promise<string> {
  if (processStdin.isTTY) return Promise.resolve("");
  return new Promise((resolveP) => {
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      processStdin.removeAllListeners();
      resolveP(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    processStdin.on("data", (c: Buffer) => chunks.push(c));
    processStdin.on("end", () => {
      clearTimeout(timer);
      finish();
    });
    processStdin.on("error", () => {
      clearTimeout(timer);
      finish();
    });
  });
}

// The agent's session transcript, when the Stop-hook payload provides it. UNTRUSTED:
// it only focuses adjudication; the verifier still gates every claim (Phase 7). Any
// failure (no stdin, no path, unreadable file) yields undefined — the shift runs
// exactly as before. Handles Claude Code (`transcript_path`) and a raw/`transcript`
// payload; the tail is kept since recent activity is the relevant part.
async function readHookTranscript(): Promise<string | undefined> {
  try {
    const raw = await readStdinText();
    if (!raw.trim()) return undefined;
    let payload: Record<string, unknown> | null = null;
    try {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return raw.slice(-8000); // stdin was the transcript text itself, not a JSON envelope
    }
    const path = payload?.["transcript_path"] ?? payload?.["transcriptPath"];
    if (typeof path === "string") {
      const content = await readFile(path, "utf8");
      return content.slice(-8000);
    }
    if (typeof payload?.["transcript"] === "string") return (payload["transcript"] as string).slice(-8000);
    return undefined;
  } catch {
    return undefined;
  }
}

async function cmdShift(args: string[]): Promise<void> {
  const noModel = flag(args, "--no-model");
  const quiet = flag(args, "--quiet");
  const forceOpen = flag(args, "--open");
  const hook = flag(args, "--hook");
  const out = option(args, "--out");
  const host = option(args, "--host");
  const root = rootArg(args);
  // In hook mode, keep stdout reserved for the single JSON object the Stop-hook
  // contract demands — every human line goes to stderr instead.
  const log = hook ? (line: string) => console.error(line) : (line: string) => console.log(line);
  const client = noModel ? deadClient : selectModelClient({ host, timeoutMs: 120_000 });
  // Only consult stdin in hook mode (the Stop hook pipes its payload there).
  const transcript = hook ? await readHookTranscript() : undefined;
  const outcome = await runShift({ root, client, ...(out ? { outPath: resolve(out) } : {}), ...(transcript ? { transcript } : {}) });
  reportShift(outcome, log);
  if (!outcome.folded && outcome.htmlPath) {
    try {
      const opened = await maybeOpenShiftCard({ htmlPath: outcome.htmlPath, quiet, forceOpen });
      if (opened) {
        log("  opened in browser");
      }
    } catch (error) {
      log(`  open failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (hook) {
    process.stdout.write(`${shiftHookJson(outcome)}\n`);
  }
}

async function cmdStatus(args: string[]): Promise<void> {
  const json = flag(args, "--json");
  const root = rootArg(args);
  const progress = json ? undefined : createCliProgress();
  let status: MappamindStatus;
  try {
    status = await getMappamindStatus({
      root,
      ...(progress ? { progress: progress.progress } : {})
    });
  } finally {
    progress?.stop();
  }
  if (json) {
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  reportStatus(status);
}

async function confirmSetup(status: MappamindStatus): Promise<boolean> {
  if (!processStdin.isTTY) {
    return false;
  }
  const reason = status.baseline.state === "missing" ? "No baseline exists" : "The baseline is stale";
  const advisory = largeRepoAdvisory(status.filesSeen);
  if (advisory) console.error(`mappamind: ${advisory}`);
  if (status.baseline.warning) console.error(`mappamind: ${status.baseline.warning}`);
  const rl = createInterface({ input: processStdin, output: processStdout });
  try {
    const action = status.baseline.state === "missing" ? "Run initial Mappamind baseline now" : "Refresh Mappamind baseline now";
    const answer = await rl.question(`${reason} for ${status.root}. ${action}? [y/N] `);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    rl.close();
  }
}

async function cmdSetup(args: string[]): Promise<void> {
  const yes = flag(args, "--yes");
  const force = flag(args, "--force");
  const json = flag(args, "--json");
  const host = option(args, "--host") ?? option(args, "--platform");
  if (!host) {
    throw new Error(
      [
        "setup needs a model host for baseline synthesis.",
        "",
        "Run one of:",
        "  mappamind setup . --host claude --yes",
        "  mappamind setup . --host codex --yes"
      ].join("\n")
    );
  }
  const root = rootArg(args);
  const client = selectModelClient({ host, timeoutMs: 300_000 });
  const progress = json ? undefined : createCliProgress();
  let outcome: SetupOutcome;
  try {
    outcome = await runSetup({
      root,
      client,
      force,
      assumeYes: yes,
      ...(yes ? {} : { confirm: confirmSetup }),
      ...(progress ? { progress: progress.progress } : {})
    });
  } finally {
    progress?.stop();
  }
  if (json) {
    console.log(JSON.stringify(outcome, null, 2));
    return;
  }
  reportSetup(outcome);
  if (outcome.ran && outcome.studioPath) {
    try {
      const opened = await maybeOpenShiftCard({ htmlPath: outcome.studioPath });
      if (opened) {
        console.log("  opened in browser");
      }
    } catch (error) {
      console.log(`  open failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function agentTarget(args: string[]): AgentHookTarget {
  const raw = option(args, "--agent") ?? "all";
  if (raw === "all" || raw === "claude" || raw === "codex") {
    return raw;
  }
  throw new Error(`--agent must be one of: all, claude, codex (got ${raw})`);
}

async function cmdHooks(args: string[]): Promise<void> {
  const install = flag(args, "--install");
  const remove = flag(args, "--remove") || flag(args, "--uninstall");
  const target = agentTarget(args);
  const root = rootArg(args);
  if (install && remove) {
    throw new Error("Use either --install or --remove, not both.");
  }
  if (!install) {
    if (remove) {
      if (target === "all" || target === "claude") {
        const path = await removeClaudeHooks(root);
        console.log(`mappamind: Claude Code hooks removed from ${path}`);
      }
      if (target === "all" || target === "codex") {
        const path = await removeCodexHooks(root);
        console.log(`mappamind: Codex hooks removed from ${path}`);
      }
      console.log("  Removed project-level Mappamind hooks only; plugin-bundled hooks are managed in the agent app.");
      return;
    }
    if (target === "all" || target === "claude") {
      console.log("Claude Code (.claude/settings.json):");
      console.log(JSON.stringify(claudeHooksConfig(), null, 2));
    }
    if (target === "all") {
      console.log("");
    }
    if (target === "all" || target === "codex") {
      console.log("Codex (.codex/hooks.json):");
      console.log(JSON.stringify(codexHooksConfig(), null, 2));
    }
    console.log("\nRun: mappamind hooks [root] --install [--agent all|claude|codex]");
    console.log("Cleanup: mappamind hooks [root] --remove [--agent all|claude|codex]");
    console.log("Root can be a git repo or a workspace directory containing git repos.");
    console.log("The Stop hook prints `card: file://...` and opens the card unless MAPPAMIND_OPEN=0.");
    console.log("Codex users must review/trust project hooks with /hooks before non-managed hooks run.");
    console.log("If the Codex plugin is installed, avoid also installing project Codex hooks, or remove them with --remove --agent codex.");
    return;
  }
  const binPath = resolveBinPath();
  if (target === "all" || target === "claude") {
    const path = await installClaudeHooks(root, binPath);
    console.log(`mappamind: Claude Code hooks installed in ${path}`);
  }
  if (target === "all" || target === "codex") {
    const path = await installCodexHooks(root, binPath);
    console.log(`mappamind: Codex hooks installed in ${path}`);
  }
  console.log("  SessionStart -> mappamind snapshot <root> (records the BEFORE)");
  console.log("  Stop         -> mappamind shift <root>    (renders the card)");
  console.log("  root         -> a git repo, or a workspace directory containing git repos");
  console.log("  URL surface  -> stdout line `card: file://...`; browser opens unless MAPPAMIND_OPEN=0");
  if (target === "all" || target === "codex") {
    console.log("  Codex        -> run /hooks once to review and trust the project hooks.");
    console.log("  If the Codex plugin is installed, use either plugin hooks or project hooks, not both.");
  }
}

async function cmdWatch(args: string[]): Promise<void> {
  const noModel = flag(args, "--no-model");
  const intervalSec = Number(option(args, "--interval") ?? "30");
  const host = option(args, "--host");
  const root = rootArg(args);
  const client = noModel ? deadClient : selectModelClient({ host, timeoutMs: 120_000 });

  const taken = await takeSnapshot(root);
  console.log(`mappamind: watching ${root} (before = ${taken.files} files, every ${intervalSec}s)`);

  let lastChangedKey = "";
  const tick = async (): Promise<void> => {
    try {
      const outcome = await runShift({ root, client });
      const key = outcome.changedPaths.join("\n");
      if (key === lastChangedKey) return; // nothing new since the last card
      lastChangedKey = key;
      reportShift(outcome);
    } catch (error) {
      console.error(`mappamind: watch tick failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  // poll loop: deliberate over fs events for v1 — same pipe, no extra machinery
  setInterval(() => {
    void tick();
  }, Math.max(5, intervalSec) * 1000);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "snapshot": {
      const root = rootArg(args);
      const { path, files, repos } = await takeSnapshot(root);
      console.log(`mappamind: snapshot of ${root} (${files} files across ${repos} repo${repos === 1 ? "" : "s"}) -> ${path}`);
      return;
    }
    case "shift":
      return cmdShift(args);
    case "status":
      return cmdStatus(args);
    case "setup":
      return cmdSetup(args);
    case "hooks":
      return cmdHooks(args);
    case "watch":
      return cmdWatch(args);
    case "baseline": {
      // Legacy baseline summary: delegate to the existing baseline CLI in-process.
      process.argv = [process.argv[0]!, "mappamind-baseline", ...args];
      await import("./cli.js");
      return;
    }
    default:
      console.error(
        [
          "usage: mappamind <command>",
          "  snapshot [root]                          record the session-start BEFORE",
          "  shift [root] [--no-model] [--out file] [--quiet] [--open] [--hook] [--host claude|codex]",
          "                                           render the card; --hook emits Stop-hook JSON; --host picks the model CLI",
          "  hooks [root] [--install|--remove] [--agent all|claude|codex]",
          "                                           Claude Code + Codex hook config",
          "  status [root] [--json]                  show baseline and hook state",
          "  setup [root] --host claude|codex [--yes] [--force]",
          "                                           run first baseline and open Studio",
          "  baseline <root...>                       grounded baseline summary",
          "  watch [root] [--interval s] [--no-model] solo-human mode (polled)"
        ].join("\n")
      );
      process.exit(command ? 2 : 0);
  }
}

main().catch((error: unknown) => {
  if (process.env["MAPPAMIND_DEBUG"] === "1" && error instanceof Error) {
    console.error(error.stack ?? error.message);
  } else {
    console.error(`mappamind: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(1);
});
