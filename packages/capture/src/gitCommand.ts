import { spawn } from "node:child_process";

export type GitCommandOptions = {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
};

export type GitCommandResult = {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export async function runGit(
  args: readonly string[],
  options: GitCommandOptions
): Promise<GitCommandResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      child.stdout.removeAllListeners();
      child.stderr.removeAllListeners();
      child.removeAllListeners();
      callback();
    };

    const fail = (error: Error): void => {
      if (!child.killed) {
        child.kill("SIGTERM");
      }
      finish(() => reject(error));
    };

    const collect = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (settled) {
        return;
      }
      const nextBytes = chunk.byteLength;
      if (target === "stdout") {
        stdoutBytes += nextBytes;
        if (stdoutBytes > maxOutputBytes) {
          fail(new Error(`git ${args.join(" ")} exceeded stdout limit`));
          return;
        }
        stdout += chunk.toString("utf8");
        return;
      }

      stderrBytes += nextBytes;
      if (stderrBytes > maxOutputBytes) {
        fail(new Error(`git ${args.join(" ")} exceeded stderr limit`));
        return;
      }
      stderr += chunk.toString("utf8");
    };

    const timeout = setTimeout(() => {
      fail(new Error(`git ${args.join(" ")} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
    child.on("error", fail);
    child.on("close", (exitCode) => {
      finish(() => {
        resolve({
          stdout,
          stderr,
          exitCode: exitCode ?? 1
        });
      });
    });
  });
}
