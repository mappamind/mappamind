// Ground truth for cross-service CHANNELS (plan Phase 0). The yardstick the model
// never sees: a hand-labeled list of the true cross-service edges in a workspace —
// who produces, who consumes, over what, in which files. Held-out labels live
// OUTSIDE git (read by path) so the system is tested on workspaces it was never
// tuned on (plan go-condition #2).
//
// Semantics: `from` consumes / calls; `to` produces / declares. `consumerFile`
// lives in `from`, `producerFile` lives in `to`. Direction is part of the label
// because getting it backwards is a poison pill, not a near-miss (§I3).

export type ChannelEdgeLabel = {
  readonly from: string; // consumer service
  readonly to: string; // producer service
  readonly kind: string; // http | queue | rpc | event | data | di (free string; scoring stays decoupled from seam)
  readonly producerFile: string; // file in `to` that declares the channel
  readonly consumerFile: string; // file in `from` that consumes it
};

export type ChannelGroundTruth = {
  readonly label: string;
  readonly edges: readonly ChannelEdgeLabel[];
};

function str(record: Record<string, unknown>, key: string, where: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where} needs a non-empty string \`${key}\``);
  }
  return value;
}

export function validateChannelGroundTruth(value: unknown): ChannelGroundTruth {
  if (typeof value !== "object" || value === null) {
    throw new Error("channel ground truth must be an object");
  }
  const record = value as Record<string, unknown>;
  const label = record["label"];
  if (typeof label !== "string" || label.length === 0) {
    throw new Error("channel ground truth needs a non-empty `label`");
  }
  if (!Array.isArray(record["edges"])) {
    throw new Error("channel ground truth needs an `edges` array");
  }
  const edges = record["edges"].map((edge, index): ChannelEdgeLabel => {
    if (typeof edge !== "object" || edge === null) {
      throw new Error(`edge ${index} is not an object`);
    }
    const e = edge as Record<string, unknown>;
    const where = `edge ${index}`;
    return {
      from: str(e, "from", where),
      to: str(e, "to", where),
      kind: str(e, "kind", where),
      producerFile: str(e, "producerFile", where),
      consumerFile: str(e, "consumerFile", where)
    };
  });
  return { label, edges };
}
