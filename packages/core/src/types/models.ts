import type { JsonObject } from "./json.js";

export type MappamindMode = "construction" | "alteration";

export type EvidenceEvent = {
  readonly eventId: string;
  readonly repoId: string;
  readonly sessionId?: string;
  readonly episodeId?: string;
  readonly source: string;
  readonly eventType: string;
  readonly cwd?: string;
  readonly path?: string;
  readonly beforeHash?: string;
  readonly afterHash?: string;
  readonly payload?: JsonObject;
  readonly timestamp: string;
};

export type EvidenceRedactionState =
  | "not_required"
  | "redacted"
  | "metadata_only"
  | "unsafe_for_export";
