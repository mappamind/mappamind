// Build the deterministic WorkspaceModel from facts.
//
// The non-trivial piece is resolving each import to a file in the repo — per
// language, via resolvers.ts. What resolves becomes a dependency edge (the internal
// graph); what does not is counted unresolved, never guessed.

import type { DependencyEdge, LanguageCount, ModuleNode, RepoFiles, WorkspaceModel } from "./model.js";
import { resolveImport } from "./resolvers.js";

export function buildWorkspaceModel(repos: readonly RepoFiles[]): WorkspaceModel {
  const modules: ModuleNode[] = [];
  const edges: DependencyEdge[] = [];
  const languageCounts = new Map<string, number>();
  let unresolvedImports = 0;

  for (const repo of repos) {
    const files = repo.files.map((file) => file.path);

    for (const file of repo.files) {
      modules.push({
        repo: repo.repo,
        path: file.path,
        language: file.language,
        symbolCount: file.symbols.length,
        exportNames: file.exports.map((exported) => exported.name)
      });

      languageCounts.set(file.language, (languageCounts.get(file.language) ?? 0) + 1);

      for (const imported of file.imports) {
        const target = resolveImport(file.path, file.language, imported.module, files);
        if (target && target !== file.path) {
          edges.push({
            repo: repo.repo,
            from: file.path,
            to: target,
            ...(imported.edgeKind ? { edgeKind: imported.edgeKind } : {})
          });
        } else if (!target) {
          unresolvedImports += 1;
        }
      }
    }
  }

  const languages: LanguageCount[] = [...languageCounts.entries()]
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files);

  return {
    repos: repos.map((repo) => repo.repo),
    modules,
    edges,
    unresolvedImports,
    languages
  };
}
