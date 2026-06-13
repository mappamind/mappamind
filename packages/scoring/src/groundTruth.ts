// Ground truth for scoring a baseline (M3b, Point 2).
//
// A hand-authored, human-RATIFIED list of the capabilities a competent engineer
// would say a repo/workspace has, and the files that belong to each. This is the
// yardstick; the model never sees it. The REAL dogfood/held-out fixtures live
// OUTSIDE git (read by path) so private product specifics never enter the
// public-bound tree — only synthetic fixtures are committed.

// One expected capability. `files` are "repo/file" keys the founder considers part
// of it. `aliases` lets a ratifier note alternative names (informational only;
// matching is by file overlap, not name, so the model's wording cannot game it).
export type GroundTruthCapability = {
  readonly name: string;
  readonly files: readonly string[]; // "repo/file" keys
  readonly aliases?: readonly string[];
};

export type GroundTruth = {
  readonly label: string; // e.g. "dogfood-backend", "held-out-workspace"
  readonly capabilities: readonly GroundTruthCapability[];
};

// Defensive validation for a GT loaded from disk: the human edits these by hand, so
// catch malformed fixtures loudly rather than scoring against garbage.
export function validateGroundTruth(value: unknown): GroundTruth {
  if (typeof value !== "object" || value === null) {
    throw new Error("ground truth must be an object");
  }
  const record = value as Record<string, unknown>;
  const label = record["label"];
  if (typeof label !== "string" || label.length === 0) {
    throw new Error("ground truth needs a non-empty `label`");
  }
  if (!Array.isArray(record["capabilities"])) {
    throw new Error("ground truth needs a `capabilities` array");
  }
  const capabilities = record["capabilities"].map((cap, index): GroundTruthCapability => {
    if (typeof cap !== "object" || cap === null) {
      throw new Error(`capability ${index} is not an object`);
    }
    const capRecord = cap as Record<string, unknown>;
    const name = capRecord["name"];
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`capability ${index} needs a non-empty \`name\``);
    }
    if (!Array.isArray(capRecord["files"]) || capRecord["files"].length === 0) {
      throw new Error(`capability "${name}" needs a non-empty \`files\` array`);
    }
    const files = capRecord["files"].map((file) => {
      if (typeof file !== "string" || file.length === 0) {
        throw new Error(`capability "${name}" has a non-string file entry`);
      }
      return file;
    });
    const aliases = Array.isArray(capRecord["aliases"])
      ? capRecord["aliases"].filter((alias): alias is string => typeof alias === "string")
      : undefined;
    return { name, files, ...(aliases ? { aliases } : {}) };
  });
  return { label, capabilities };
}
