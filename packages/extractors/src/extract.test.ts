import assert from "node:assert/strict";
import test from "node:test";

import { extractFileFacts, isExtractable, supportedLanguages } from "./extract.js";

test("reports which languages are extractable", () => {
  for (const language of ["typescript", "javascript", "go", "dart"]) {
    assert.equal(isExtractable(language), true, `${language} should be extractable`);
  }
  assert.equal(isExtractable("cobol"), false);
  assert.ok(supportedLanguages().includes("dart"));
});

test("typescript: symbols, imports, and the seam call signal", async () => {
  const code = [
    "import { foo } from './bar';",
    "export function hello(name) { return greet(name); }",
    "class Widget { build() { return 1; } }",
    "const f = functions.httpsCallable('chatStylist');"
  ].join("\n");

  const facts = await extractFileFacts("a.ts", code, "typescript");
  assert.equal(facts.parseError, undefined);
  assert.deepEqual(
    facts.imports.map((i) => i.module),
    ["./bar"]
  );
  const names = facts.symbols.map((s) => `${s.kind}:${s.name}`);
  assert.ok(names.includes("function:hello"));
  assert.ok(names.includes("class:Widget"));
  assert.ok(names.includes("method:build"));
  const seam = facts.calls.find((c) => c.callee === "functions.httpsCallable");
  assert.ok(seam, "expected the httpsCallable call");
  assert.deepEqual(seam.args, ["chatStylist"]);
});

test("typescript: anchors tag every string literal by structural role", async () => {
  const code = [
    "import { foo } from './bar';",
    "fetch('/api/charge');",
    "const label = 'just a literal';"
  ].join("\n");

  const facts = await extractFileFacts("a.ts", code, "typescript");
  assert.equal(facts.parseError, undefined);
  const byText = new Map(facts.anchors.map((a) => [a.text, a.role]));
  // import specifier -> "import"; call argument -> "call-arg"; bare string -> "literal"
  assert.equal(byText.get("./bar"), "import");
  assert.equal(byText.get("/api/charge"), "call-arg");
  assert.equal(byText.get("just a literal"), "literal");
  // role is structural, never content-based: a route-looking string is only
  // "call-arg" because it sits in a call, not because of what it spells.
  assert.ok(facts.anchors.every((a) => typeof a.line === "number" && a.line >= 1));
});

test("re-exports are captured as import edges (barrel files)", async () => {
  // TS/JS/TSX: `export ... from` is a dependency edge, not just a declaration.
  const ts = await extractFileFacts("index.ts", "export { default } from './Widget';\nexport * from './helpers';", "typescript");
  assert.equal(ts.parseError, undefined);
  assert.deepEqual(
    ts.imports.map((i) => ({ module: i.module, edgeKind: i.edgeKind })),
    [
      { module: "./Widget", edgeKind: "re-export" },
      { module: "./helpers", edgeKind: "re-export" }
    ]
  );

  // Dart: `export '...'` (the FlutterFlow barrel form) alongside a normal import.
  const dart = await extractFileFacts(
    "lib/index.dart",
    "export '/pages/foo.dart' show Foo;\nexport 'package:app/bar.dart';\nimport 'package:app/x.dart';",
    "dart"
  );
  assert.equal(dart.parseError, undefined);
  assert.deepEqual(
    dart.imports.map((i) => ({ module: i.module, edgeKind: i.edgeKind })),
    [
      { module: "/pages/foo.dart", edgeKind: "re-export" },
      { module: "package:app/bar.dart", edgeKind: "re-export" },
      { module: "package:app/x.dart", edgeKind: undefined }
    ]
  );
});

test("go: imports, methods, type, and a string-arg call", async () => {
  const code = [
    "package main",
    'import "fmt"',
    "type Server struct{ name string }",
    "func (s *Server) PlaceOrder() error { return nil }",
    'func main() { fmt.Println("hi") }'
  ].join("\n");

  const facts = await extractFileFacts("main.go", code, "go");
  assert.equal(facts.parseError, undefined);
  assert.ok(facts.imports.some((i) => i.module === "fmt"));
  const names = facts.symbols.map((s) => `${s.kind}:${s.name}`);
  assert.ok(names.includes("type:Server"));
  assert.ok(names.includes("method:PlaceOrder"));
  assert.ok(names.includes("function:main"));
  const call = facts.calls.find((c) => c.callee === "fmt.Println");
  assert.ok(call, "expected fmt.Println call");
  assert.deepEqual(call.args, ["hi"]);
});

test("dart: import uri, class, function, and the callable seam signal", async () => {
  const code = [
    "import 'package:cloud_functions/cloud_functions.dart';",
    "class ApiClient {",
    "  Future<void> validate() async {",
    "    final callable = FirebaseFunctions.instance.httpsCallable('validateOutfit');",
    "  }",
    "}",
    "void main() { greet('hi'); }"
  ].join("\n");

  const facts = await extractFileFacts("api.dart", code, "dart");
  assert.equal(facts.parseError, undefined);
  assert.ok(facts.imports.some((i) => i.module.includes("cloud_functions")));
  const names = facts.symbols.map((s) => `${s.kind}:${s.name}`);
  assert.ok(names.includes("class:ApiClient"));
  // the callable seam signal: callee name + the string argument
  const seam = facts.calls.find((c) => c.callee === "httpsCallable");
  assert.ok(seam, "expected the httpsCallable selector call");
  assert.deepEqual(seam.args, ["validateOutfit"]);
  const base = facts.calls.find((c) => c.callee === "greet");
  assert.ok(base && base.args[0] === "hi", "expected base call greet('hi')");
});

test("javascript: CommonJS exports.X are captured as the provider surface", async () => {
  const code = [
    "const validateOutfit = require('./validateOutfit');",
    "exports.validateOutfit = validateOutfit.validateOutfit;",
    "exports.generateOutfit = require('./generateOutfit').generateOutfit;",
    "module.exports.corsProxy = corsProxy;"
  ].join("\n");

  const facts = await extractFileFacts("index.js", code, "javascript");
  assert.equal(facts.parseError, undefined);
  const names = facts.exports.map((e) => e.name);
  assert.ok(names.includes("validateOutfit"));
  assert.ok(names.includes("generateOutfit"));
  assert.ok(names.includes("corsProxy"));
  // notably absent: chatStylist (deleted) — this is what makes a dangling call detectable
  assert.ok(!names.includes("chatStylist"));
});

test("typescript: `new X()` constructor calls are captured as calls (gRPC clients)", async () => {
  const facts = await extractFileFacts("gw.ts", "const c = new CartServiceClient(addr);", "typescript");
  assert.equal(facts.parseError, undefined);
  const callees = facts.calls.map((call) => call.callee);
  assert.ok(callees.includes("CartServiceClient"), `got [${callees.join(", ")}]`);
});

test("javascript: require() and dynamic import() are captured as imports", async () => {
  const code = [
    "const auth = require('./helpers/auth');",
    "const admin = require('firebase-admin');",
    "async function lazy() { return import('./generateOutfit'); }"
  ].join("\n");

  const facts = await extractFileFacts("index.js", code, "javascript");
  assert.equal(facts.parseError, undefined);
  const modules = facts.imports.map((i) => i.module);
  assert.ok(modules.includes("./helpers/auth"), "relative require");
  assert.ok(modules.includes("firebase-admin"), "package require");
  assert.ok(modules.includes("./generateOutfit"), "dynamic import");
});

test("typescript: ESM export declarations are captured", async () => {
  const code = ["export function handler() {}", "export class Service {}", "export const VERSION = '1';"].join("\n");
  const facts = await extractFileFacts("svc.ts", code, "typescript");
  const names = facts.exports.map((e) => e.name);
  assert.ok(names.includes("handler"));
  assert.ok(names.includes("Service"));
  assert.ok(names.includes("VERSION"));
});

// Tier 1 + Tier 2 coverage: each new language must parse a representative snippet
// (no parseError) and extract its key symbol and import. One case per language so a
// regression in any single grammar query fails loudly and specifically.
const LANGUAGE_CASES: ReadonlyArray<{
  readonly language: string;
  readonly path: string;
  readonly code: string;
  readonly symbol: string;
  readonly import?: string;
}> = [
  { language: "tsx", path: "App.tsx", code: "import {useState} from 'react';\nexport function App(){ return <div>{useState(0)}</div>; }", symbol: "App", import: "react" },
  { language: "python", path: "m.py", code: "import os\nfrom http import client\ndef handler(r):\n    return process(r, 'GET')\nclass Service:\n    pass", symbol: "handler", import: "os" },
  { language: "java", path: "M.java", code: "import com.foo.Bar;\npublic class Service { public void run(){ doThing(\"x\"); } }", symbol: "Service", import: "com.foo.Bar" },
  { language: "csharp", path: "M.cs", code: "using System.IO;\nclass Service { public void Run(){ DoThing(\"x\"); } }", symbol: "Service", import: "System.IO" },
  { language: "c", path: "m.c", code: "#include \"local.h\"\nint add(int a){ return foo(a); }", symbol: "add", import: "local.h" },
  { language: "cpp", path: "m.cpp", code: "#include <vector>\nclass Widget { public: void run(); };", symbol: "Widget", import: "<vector>" },
  { language: "php", path: "m.php", code: "<?php\nuse App\\Models\\User;\nfunction handler($r){ return process('x'); }", symbol: "handler", import: "App\\Models\\User" },
  { language: "ruby", path: "m.rb", code: "require 'json'\nclass Service\n  def run\n    process('x')\n  end\nend", symbol: "Service", import: "json" },
  { language: "rust", path: "m.rs", code: "use foo::Bar;\nfn handler(r: i32) -> i32 { process(r) }\nstruct Point { x: i32 }", symbol: "handler", import: "foo::Bar" },
  { language: "kotlin", path: "M.kt", code: "import kotlin.collections.List\nfun handler(r: Int): Int { return process(r) }\nclass Service {}", symbol: "handler", import: "kotlin.collections.List" },
  { language: "swift", path: "M.swift", code: "import Foundation\nfunc handler(r: Int) -> Int { return process(r) }\nclass Service {}", symbol: "handler", import: "Foundation" },
  { language: "scala", path: "M.scala", code: "import scala.collection.mutable\nobject Main { def handler(r: Int): Int = process(r) }", symbol: "handler", import: "scala.collection.mutable" },
  { language: "shell", path: "m.sh", code: "#!/bin/bash\nfunction deploy() {\n  echo build\n}", symbol: "deploy" }
];

for (const testCase of LANGUAGE_CASES) {
  test(`${testCase.language}: extracts symbols and imports`, async () => {
    const facts = await extractFileFacts(testCase.path, testCase.code, testCase.language);
    assert.equal(facts.parseError, undefined, `parse error: ${facts.parseError}`);
    const names = facts.symbols.map((symbol) => symbol.name);
    assert.ok(names.includes(testCase.symbol), `expected symbol ${testCase.symbol}, got [${names.join(", ")}]`);
    if (testCase.import) {
      const modules = facts.imports.map((imported) => imported.module);
      assert.ok(modules.includes(testCase.import), `expected import ${testCase.import}, got [${modules.join(", ")}]`);
    }
  });
}

test("unsupported language returns empty facts, not an error", async () => {
  const facts = await extractFileFacts("x.cob", "PROGRAM-ID. X.", "cobol");
  assert.equal(facts.parseError, undefined);
  assert.deepEqual(facts.symbols, []);
  assert.deepEqual(facts.calls, []);
  assert.deepEqual(facts.exports, []);
});
