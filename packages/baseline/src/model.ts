// The deterministic structural model (M3a).
//
// This is the language-agnostic skeleton of a workspace, built from facts alone,
// no LLM. It is what the grounded capability synthesis (M3b) clusters and what the
// baseline renders. Nothing here knows any specific framework or product.

import type { FileFacts } from "@mappamind_/extractors";

// Facts for one repository in the (possibly multi-repo) workspace.
export type RepoFiles = {
  readonly repo: string;
  readonly files: readonly FileFacts[];
};

// One module (file) in the model.
export type ModuleNode = {
  readonly repo: string;
  readonly path: string;
  readonly language: string;
  readonly symbolCount: number;
  readonly exportNames: readonly string[];
};

// A resolved internal dependency: `from` imports `to`, within one repo.
export type DependencyEdge = {
  readonly repo: string;
  readonly from: string;
  readonly to: string;
  readonly edgeKind?: "re-export";
};

export type LanguageCount = {
  readonly language: string;
  readonly files: number;
};

export type WorkspaceModel = {
  readonly repos: readonly string[];
  readonly modules: readonly ModuleNode[];
  readonly edges: readonly DependencyEdge[];
  // Imports we could not resolve to a file in the same repo (external packages,
  // or resolution we do not yet support). Counted, never hidden.
  readonly unresolvedImports: number;
  readonly languages: readonly LanguageCount[];
};
