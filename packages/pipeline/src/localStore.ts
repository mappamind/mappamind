import { join } from "node:path";

// Product default: keep Mappamind's durable memory beside the workspace/repo the
// agent is working in. This makes the baseline, channel cache, before snapshot,
// and shift ledger discoverable under `.mappamind/` instead of hidden in a user
// state directory. Tests and custom installs can still override with
// MAPPAMIND_STATE_DIR.
export function workspaceStateEnv(root: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (env["MAPPAMIND_STATE_DIR"]) return env;
  return { ...env, MAPPAMIND_STATE_DIR: join(root, ".mappamind", "state") };
}
