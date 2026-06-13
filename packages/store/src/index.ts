export {
  stateRoot,
  workspaceIdFor,
  workspaceDir,
  baselinePath,
  factsHashFor,
  workspaceIdentity
} from "./paths.js";
export {
  writeBaseline,
  readBaseline,
  isStale,
  loadBaselineStatus
} from "./store.js";
export type { BaselineStatus } from "./store.js";
