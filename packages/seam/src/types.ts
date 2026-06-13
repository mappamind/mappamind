// The seam model — technology-agnostic.
//
// A seam is a NAMED KEY that is referenced on one side of a boundary and defined
// on the other: a callable name, an RPC, a route, a queue topic, a table. The
// engine never hardcodes a technology. It works from two universal signals:
//   - a REFERENCE: a key named indirectly (a string-literal call argument)
//   - a DEFINITION: a name a module provides (an export or a declared symbol)
// and matches them across the workspace. Specific technologies are expressed as
// declarative CONVENTIONS (see conventions.ts), which only sharpen and label what
// the backbone already finds.

import type { FileFacts } from "@mappamind_/extractors";

export type SeamSide = "reference" | "definition";
export type OccurrenceKind = "string-arg" | "export" | "symbol";

export type Occurrence = {
  readonly key: string;
  readonly side: SeamSide;
  readonly kind: OccurrenceKind;
  readonly repo: string;
  readonly file: string;
  readonly line: number;
  readonly via?: string; // the callee, for string-arg references
  readonly seamType?: string; // set when a convention recognized this occurrence
};

export type SeamStatus =
  | "in_sync" // referenced and defined
  | "dangling" // referenced but never defined (the broken edge)
  | "orphan"; // defined but never referenced

export type Confidence =
  | "high" // a convention recognized it (we know it is a contract)
  | "medium"; // backbone-only: a key crosses repos, but no convention named it

export type SeamContract = {
  readonly key: string;
  readonly status: SeamStatus;
  readonly confidence: Confidence;
  readonly seamType?: string; // e.g. "callable", when a convention labeled it
  readonly crossesBoundary: boolean; // reference and definition live in different repos
  readonly references: readonly Occurrence[];
  readonly definitions: readonly Occurrence[];
};

export type SeamReport = {
  readonly contracts: readonly SeamContract[];
  readonly dangling: readonly SeamContract[]; // status === "dangling"
};

// Facts for one repository in the (possibly multi-repo) workspace.
export type RepoFacts = {
  readonly repo: string;
  readonly files: readonly FileFacts[];
};
