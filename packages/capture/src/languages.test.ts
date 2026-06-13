import assert from "node:assert/strict";
import test from "node:test";

import { classifyFile, shouldCaptureForModel } from "./languages.js";

test("classifies source languages the v1 allowlist dropped", () => {
  assert.deepEqual(classifyFile("lib/main.dart"), { language: "dart", category: "source" });
  assert.deepEqual(classifyFile("src/server.go"), { language: "go", category: "source" });
  assert.deepEqual(classifyFile("email_server.py"), { language: "python", category: "source" });
  assert.deepEqual(classifyFile("src/CartService.cs"), { language: "csharp", category: "source" });
  assert.deepEqual(classifyFile("AdService.java"), { language: "java", category: "source" });
});

test("still classifies the JS/TS the allowlist knew about", () => {
  assert.deepEqual(classifyFile("app/index.ts"), { language: "typescript", category: "source" });
  assert.deepEqual(classifyFile("a/b/c.tsx"), { language: "tsx", category: "source" });
  assert.deepEqual(classifyFile("server.js"), { language: "javascript", category: "source" });
});

test("classifies contracts (the seam) distinctly from config", () => {
  assert.deepEqual(classifyFile("protos/demo.proto"), {
    language: "protobuf",
    category: "contract"
  });
  assert.deepEqual(classifyFile("schema.graphql"), { language: "graphql", category: "contract" });
  assert.deepEqual(classifyFile("firebase.json"), { language: "json", category: "config" });
});

test("resolves compound names by their final extension", () => {
  assert.deepEqual(classifyFile("lib/foo.g.dart"), { language: "dart", category: "source" });
  assert.deepEqual(classifyFile("src/protos/Cart.proto"), {
    language: "protobuf",
    category: "contract"
  });
});

test("classifies known files without an extension", () => {
  assert.deepEqual(classifyFile("Dockerfile"), { language: "dockerfile", category: "source" });
  assert.deepEqual(classifyFile("services/api/Dockerfile"), {
    language: "dockerfile",
    category: "source"
  });
});

test("assets are recognized and excluded from model capture", () => {
  assert.deepEqual(classifyFile("assets/logo.png"), { language: "binary", category: "asset" });
  assert.equal(shouldCaptureForModel(classifyFile("assets/logo.png")), false);
  assert.equal(shouldCaptureForModel(classifyFile("fonts/Inter.ttf")), false);
});

test("unknown text is kept, not dropped", () => {
  assert.deepEqual(classifyFile("LICENSE"), { language: "unknown", category: "unknown" });
  assert.deepEqual(classifyFile("notes.xyz"), { language: "unknown", category: "unknown" });
  assert.equal(shouldCaptureForModel(classifyFile("LICENSE")), true);
});

test("source, contract, config, and doc are all captured", () => {
  assert.equal(shouldCaptureForModel(classifyFile("a.dart")), true);
  assert.equal(shouldCaptureForModel(classifyFile("a.proto")), true);
  assert.equal(shouldCaptureForModel(classifyFile("a.yaml")), true);
  assert.equal(shouldCaptureForModel(classifyFile("a.md")), true);
});
