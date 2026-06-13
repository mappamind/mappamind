// The thin model interface (M3b, Point 3).
//
// Synthesis depends only on this interface, never on a concrete model. The default
// adapter is `claude -p` (the plugin reuses the host model, no API key — D3); the
// daemon can inject an API-backed client instead for standalone runs or for stable
// scoring. Every call is returned for logging to the ledger (borrowed muscle, on
// the record).

export type ModelRequest = {
  readonly system?: string;
  readonly prompt: string;
};

export type ModelResponse = {
  readonly text: string;
};

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

// A record of one model call, for the ledger (audit + reproducibility).
export type ModelCallLog = {
  readonly label: string;
  readonly system?: string;
  readonly prompt: string;
  readonly response: string;
};
