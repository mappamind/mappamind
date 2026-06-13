import assert from "node:assert/strict";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";

import { buildWorkspaceModel } from "./build.js";
import type { RepoFiles } from "./model.js";

function file(partial: Partial<FileFacts> & { path: string; language: string }): FileFacts {
  return { symbols: [], imports: [], calls: [], exports: [], anchors: [], ...partial };
}

test("builds modules, a language breakdown, and resolves relative imports to edges", () => {
  const repo: RepoFiles = {
    repo: "app",
    files: [
      file({
        path: "src/a.ts",
        language: "typescript",
        symbols: [{ kind: "function", name: "a", line: 1 }],
        imports: [
          { module: "./b", line: 1 }, // resolves to src/b.ts
          { module: "react", line: 2 } // external -> unresolved
        ]
      }),
      file({
        path: "src/b.ts",
        language: "typescript",
        exports: [{ name: "b", line: 1 }]
      })
    ]
  };

  const model = buildWorkspaceModel([repo]);

  assert.equal(model.modules.length, 2);
  assert.deepEqual(model.languages, [{ language: "typescript", files: 2 }]);
  assert.equal(model.edges.length, 1);
  assert.deepEqual(model.edges[0], { repo: "app", from: "src/a.ts", to: "src/b.ts" });
  assert.equal(model.unresolvedImports, 1); // react
});

test("resolves directory index imports and parent paths", () => {
  const repo: RepoFiles = {
    repo: "app",
    files: [
      file({ path: "src/feature/widget.ts", language: "typescript", imports: [{ module: "../core", line: 1 }] }),
      file({ path: "src/core/index.ts", language: "typescript" })
    ]
  };
  const model = buildWorkspaceModel([repo]);
  assert.equal(model.edges.length, 1);
  assert.deepEqual(model.edges[0], { repo: "app", from: "src/feature/widget.ts", to: "src/core/index.ts" });
});

test("preserves re-export edge metadata from extractor facts", () => {
  const repo: RepoFiles = {
    repo: "app",
    files: [
      file({
        path: "src/index.ts",
        language: "typescript",
        imports: [{ module: "./widget", line: 1, edgeKind: "re-export" }]
      }),
      file({ path: "src/widget.ts", language: "typescript" })
    ]
  };
  const model = buildWorkspaceModel([repo]);
  assert.deepEqual(model.edges[0], { repo: "app", from: "src/index.ts", to: "src/widget.ts", edgeKind: "re-export" });
});

test("multi-repo: repos are independent and reported", () => {
  const model = buildWorkspaceModel([
    { repo: "app", files: [file({ path: "main.dart", language: "dart" })] },
    { repo: "backend", files: [file({ path: "index.js", language: "javascript" })] }
  ]);
  assert.deepEqual([...model.repos].sort(), ["app", "backend"]);
  assert.equal(model.modules.length, 2);
});
