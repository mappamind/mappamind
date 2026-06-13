// The curated baseline: capabilities, edges, unknowns (M3b).
//
// Two shapes live here. The PROPOSED* shapes are what the LLM emits — untrusted,
// possibly hallucinated. The grounded shapes (Capability, CapabilityEdge, Baseline)
// are what survives the leash (grounding.ts) and what we persist as baseline.json
// (D12). The leash is the only bridge between them; nothing untrusted reaches disk.

// A pointer into real code. `symbol`/`line` are optional: a file-level citation is
// enough to admit a capability, a symbol-level one is stronger and preferred.
export type Citation = {
  readonly repo: string;
  readonly file: string;
  readonly symbol?: string;
  readonly line?: number;
};

// How a capability earned its place, and how sure the leash is.
export type Provenance = "derived" | "seam" | "confirmed" | "corrected";
export type Confidence = "high" | "medium";

// ---- Untrusted: what the model proposes ------------------------------------

export type ProposedCapability = {
  readonly name: string;
  readonly summary: string;
  readonly members: readonly Citation[];
};

export type ProposedEdge = {
  readonly from: string; // a proposed capability NAME
  readonly to: string;
  readonly reason?: string;
};

export type ProposedUnknown = {
  readonly note: string;
  readonly where?: { readonly repo: string; readonly file?: string };
};

export type ProposedBaseline = {
  readonly capabilities: readonly ProposedCapability[];
  readonly edges: readonly ProposedEdge[];
  readonly unknowns: readonly ProposedUnknown[];
};

// ---- Grounded: what survives the leash and reaches disk ---------------------

export type Capability = {
  readonly id: string; // stable, content-derived; corrections key off this
  readonly name: string;
  readonly summary: string;
  readonly members: readonly Citation[]; // every one verified to exist in facts
  readonly provenance: Provenance;
  readonly confidence: Confidence; // set by the leash, never by the model
};

export type CapabilityEdge = {
  readonly from: string; // capability id
  readonly to: string;
  readonly via: "dependency" | "seam";
  readonly evidence: Citation; // the real edge/seam that backs this
};

export type Unknown = {
  readonly note: string;
  readonly where?: { readonly repo: string; readonly file?: string };
};

export type Baseline = {
  readonly schemaVersion: 1;
  readonly workspaceId: string;
  readonly derivedFrom: { readonly factsHash: string };
  readonly capabilities: readonly Capability[];
  readonly edges: readonly CapabilityEdge[];
  readonly unknowns: readonly Unknown[];
};

// What the leash dropped and why — surfaced, never silent (honest over hidden).
export type DroppedCapability = {
  readonly name: string;
  readonly reason: "no-grounded-members";
};

export type DroppedEdge = {
  readonly from: string;
  readonly to: string;
  readonly reason: "no-backing-edge" | "unknown-capability";
};

export type GroundingResult = {
  readonly baseline: Baseline;
  readonly droppedCapabilities: readonly DroppedCapability[];
  readonly droppedEdges: readonly DroppedEdge[];
};
