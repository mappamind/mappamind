import assert from "node:assert/strict";
import test from "node:test";

import { resolveImport } from "./resolvers.js";

test("python: dotted module resolves by suffix to a file or package", () => {
  const files = ["src/dags/ingest.py", "src/pkg/__init__.py", "src/pkg/util.py"];
  assert.equal(resolveImport("src/main.py", "python", "dags.ingest", files), "src/dags/ingest.py");
  assert.equal(resolveImport("src/main.py", "python", "pkg.util", files), "src/pkg/util.py");
  assert.equal(resolveImport("src/main.py", "python", "pkg", files), "src/pkg/__init__.py");
  assert.equal(resolveImport("src/main.py", "python", "os", files), undefined); // stdlib -> unresolved
});

test("python: from-import relative resolves next to the file", () => {
  const files = ["a/b/main.py", "a/b/helper.py"];
  assert.equal(resolveImport("a/b/main.py", "python", ".helper", files), "a/b/helper.py");
});

test("java/kotlin: package import maps to a directory path", () => {
  const files = ["src/main/java/com/foo/Bar.java", "app/src/Service.kt", "app/src/com/x/Repo.kt"];
  assert.equal(resolveImport("X.java", "java", "com.foo.Bar", files), "src/main/java/com/foo/Bar.java");
  assert.equal(resolveImport("X.kt", "kotlin", "com.x.Repo", files), "app/src/com/x/Repo.kt");
});

test("rust: crate/self paths resolve; std is external", () => {
  const files = ["src/foo/bar.rs", "src/baz/mod.rs", "src/lib.rs"];
  assert.equal(resolveImport("src/lib.rs", "rust", "crate::foo::bar", files), "src/foo/bar.rs");
  assert.equal(resolveImport("src/lib.rs", "rust", "crate::baz", files), "src/baz/mod.rs");
  assert.equal(resolveImport("src/lib.rs", "rust", "std::collections::HashMap", files), undefined);
});

test("php: namespace resolves by trailing segments", () => {
  const files = ["app/Models/User.php", "lib/Service.php"];
  assert.equal(resolveImport("x.php", "php", "App\\Models\\User", files), "app/Models/User.php");
});

test("ruby: require_relative resolves; gems do not", () => {
  const files = ["lib/main.rb", "lib/helper.rb"];
  assert.equal(resolveImport("lib/main.rb", "ruby", "helper", files), "lib/helper.rb");
  assert.equal(resolveImport("lib/main.rb", "ruby", "json", files), undefined);
});

test("c/cpp: quoted local includes resolve; system includes are external", () => {
  const files = ["src/main.c", "src/local.h", "src/util.c"];
  assert.equal(resolveImport("src/main.c", "c", "local.h", files), "src/local.h");
  assert.equal(resolveImport("src/main.c", "c", "<stdio.h>", files), undefined);
});

test("go: package path tail maps to a file in that directory", () => {
  const files = ["internal/cart/cart.go", "internal/cart/store.go", "cmd/main.go"];
  const resolved = resolveImport("cmd/main.go", "go", "github.com/org/demo/internal/cart", files);
  assert.ok(resolved?.startsWith("internal/cart/"));
});

test("dart: package, FlutterFlow root-absolute, and bare-relative forms resolve; sdk is external", () => {
  const files = ["lib/index.dart", "lib/widget.dart", "lib/pages/foo/foo_widget.dart", "lib/util/helper.dart"];
  // package:app/x.dart -> lib/x.dart
  assert.equal(resolveImport("lib/index.dart", "dart", "package:app/widget.dart", files), "lib/widget.dart");
  // FlutterFlow names from the lib root: '/pages/...' -> 'lib/pages/...' (the barrel re-export form)
  assert.equal(resolveImport("lib/index.dart", "dart", "/pages/foo/foo_widget.dart", files), "lib/pages/foo/foo_widget.dart");
  // a bare specifier is relative to the importing file's directory
  assert.equal(resolveImport("lib/pages/foo/foo_widget.dart", "dart", "../../util/helper.dart", files), "lib/util/helper.dart");
  // dart sdk libraries are external -> unresolved
  assert.equal(resolveImport("lib/index.dart", "dart", "dart:async", files), undefined);
});

test("relative TS imports still resolve (no regression)", () => {
  const files = ["src/a.ts", "src/b.ts", "src/feature/index.ts"];
  assert.equal(resolveImport("src/a.ts", "typescript", "./b", files), "src/b.ts");
  assert.equal(resolveImport("src/a.ts", "typescript", "./feature", files), "src/feature/index.ts");
  assert.equal(resolveImport("src/a.ts", "typescript", "react", files), undefined);
});

test("NodeNext TS: './a.js' in source resolves to the on-disk a.ts (emitted-name imports)", () => {
  const files = ["src/a.ts", "src/b.ts", "src/c.tsx", "src/m.mts", "plain/x.js", "plain/y.js"];
  assert.equal(resolveImport("src/b.ts", "typescript", "./a.js", files), "src/a.ts");
  assert.equal(resolveImport("src/b.ts", "typescript", "./c.js", files), "src/c.tsx");
  assert.equal(resolveImport("src/b.ts", "typescript", "./m.mjs", files), "src/m.mts");
  // a real .js on disk still wins over the swap — plain-JS repos are unaffected
  assert.equal(resolveImport("plain/y.js", "javascript", "./x.js", files), "plain/x.js");
});
