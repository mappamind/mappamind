// Per-language import resolution: map an import specifier to a file in the repo.
//
// Most languages do not import by relative path; they import by a logical name
// (a dotted module, a package, a namespace) whose mapping to a file depends on a
// source root we do not know. The robust, root-agnostic trick is SUFFIX MATCHING:
// turn the specifier into a path fragment and find a real file whose path ends with
// it. This resolves the common case across a monorepo without per-project config,
// and stays honest — an unmatched import is counted unresolved, never guessed.

// Find a file whose path equals or ends with one of the candidate fragments.
// Candidates are tried in order; the first hit wins. Ambiguity (same suffix in two
// files) resolves to the first — acceptable for a dependency graph.
function matchSuffix(candidates: readonly string[], files: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    for (const file of files) {
      if (file === candidate || file.endsWith(`/${candidate}`)) {
        return file;
      }
    }
  }
  return undefined;
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

// Resolve a path RELATIVE to a file's directory (./x, ../x, or bare local includes).
function resolveRelative(fromPath: string, specifier: string, exts: readonly string[], files: readonly string[]): string | undefined {
  const segments = dirOf(fromPath).split("/").filter(Boolean);
  for (const part of specifier.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segments.pop();
    else segments.push(part);
  }
  const base = segments.join("/");
  const fileSet = new Set(files);
  for (const ext of ["", ...exts]) {
    if (fileSet.has(base + ext)) return base + ext;
  }
  for (const ext of exts) {
    if (fileSet.has(`${base}/index${ext}`)) return `${base}/index${ext}`;
    if (fileSet.has(`${base}/mod${ext}`)) return `${base}/mod${ext}`;
    if (fileSet.has(`${base}/__init__${ext}`)) return `${base}/__init__${ext}`;
  }
  return undefined;
}

// a.b.c -> ["a/b/c.py", "a/b/c/__init__.py", "a/b.py", "a/b/__init__.py"]
function pythonCandidates(module: string): string[] {
  const frag = module.replace(/\./g, "/");
  const parent = frag.includes("/") ? frag.slice(0, frag.lastIndexOf("/")) : frag;
  return [`${frag}.py`, `${frag}.pyi`, `${frag}/__init__.py`, `${parent}.py`, `${parent}/__init__.py`];
}

// com.foo.Bar -> ["com/foo/Bar.java", ...] (Java/Kotlin: package = directory)
function dottedCandidates(module: string, exts: readonly string[]): string[] {
  const frag = module.replace(/\./g, "/");
  return exts.map((ext) => `${frag}${ext}`);
}

// crate::a::b / a::b -> a/b.rs, a/b/mod.rs (std/core/external crates excluded)
function rustCandidates(module: string): string[] {
  const parts = module.split("::").filter(Boolean);
  const head = parts[0];
  if (head === "std" || head === "core" || head === "alloc") return [];
  const rest = (head === "crate" || head === "self" || head === "super" ? parts.slice(1) : parts);
  if (rest.length === 0) return [];
  const frag = rest.join("/");
  const parent = rest.slice(0, -1).join("/");
  return [`${frag}.rs`, `${frag}/mod.rs`, ...(parent ? [`${parent}.rs`, `${parent}/mod.rs`] : [])];
}

// App\Models\User -> App/Models/User.php, Models/User.php, User.php (PSR-4-ish)
function phpCandidates(module: string): string[] {
  const parts = module.split("\\").filter(Boolean);
  const full = parts.join("/");
  const last2 = parts.slice(-2).join("/");
  const last1 = parts.slice(-1).join("/");
  return [`${full}.php`, `${last2}.php`, `${last1}.php`];
}

export function resolveImport(
  fromPath: string,
  language: string,
  specifier: string,
  files: readonly string[]
): string | undefined {
  // Path-relative forms (./x ../x) — JS/TS and other slash-relative imports.
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const exts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".dart", ".py", ".rb", ".go"];
    const direct = resolveRelative(fromPath, specifier, exts, files);
    if (direct !== undefined) return direct;
    // NodeNext/ESM TypeScript: source imports name the EMITTED file ("./a.js")
    // while the file on disk is "./a.ts". Without this swap an entire NodeNext
    // codebase resolves zero intra-package edges — and every change folds as
    // cosmetic, the false-"safe" that breaks trust.
    const stripped = specifier.replace(/\.([mc]?)js$/, "");
    if (stripped !== specifier) {
      return resolveRelative(fromPath, stripped, [".ts", ".tsx", ".mts", ".cts"], files);
    }
    return undefined;
  }

  switch (language) {
    case "python": {
      // Python relative imports use leading dots as package levels (.x = same
      // package, ..x = parent), dot-separated — not slash paths.
      if (specifier.startsWith(".")) {
        let dots = 0;
        while (specifier[dots] === ".") dots += 1;
        const rest = specifier.slice(dots).replace(/\./g, "/");
        const segments = dirOf(fromPath).split("/").filter(Boolean);
        for (let i = 1; i < dots; i += 1) segments.pop();
        const base = [...segments, rest].filter(Boolean).join("/");
        return matchSuffix([`${base}.py`, `${base}/__init__.py`], files);
      }
      return matchSuffix(pythonCandidates(specifier), files);
    }
    case "java":
      return matchSuffix(dottedCandidates(specifier, [".java"]), files);
    case "kotlin":
      return matchSuffix(dottedCandidates(specifier, [".kt"]), files);
    case "scala":
      return matchSuffix(dottedCandidates(specifier, [".scala"]), files);
    case "rust":
      return matchSuffix(rustCandidates(specifier), files);
    case "php":
      return matchSuffix(phpCandidates(specifier), files);
    case "ruby":
      // require_relative names resolve next to the file; gems (require) won't match.
      return resolveRelative(fromPath, specifier, [".rb"], files);
    case "c":
    case "cpp":
      // System includes (<...>) are external; quoted local includes are relative.
      if (specifier.startsWith("<")) return undefined;
      return resolveRelative(fromPath, specifier, [".h", ".hpp", ".hh", ".c", ".cc", ".cpp"], files);
    case "go": {
      // Go imports a package (directory). Map the path tail to a directory and edge
      // to a representative file in it. Imprecise (packages are multi-file) but gives
      // intra-service wiring; the module prefix is unknown so we suffix-match.
      const tail = specifier.split("/").slice(-2).join("/");
      const inDir = files.find((file) => file.endsWith(".go") && dirOf(file).endsWith(tail));
      return inDir;
    }
    case "dart": {
      if (specifier.startsWith("dart:")) return undefined; // SDK library
      if (specifier.startsWith("package:")) {
        const withoutScheme = specifier.slice("package:".length);
        const slash = withoutScheme.indexOf("/");
        if (slash > 0) {
          const rest = withoutScheme.slice(slash + 1);
          return matchSuffix([`lib/${rest}`, `lib/${rest.replace(/\.dart$/, "")}.dart`], files);
        }
        return undefined;
      }
      // FlutterFlow names imports/exports from the lib root: '/pages/x.dart' -> 'lib/pages/x.dart'.
      if (specifier.startsWith("/")) {
        return matchSuffix([`lib${specifier}`, `lib${specifier.replace(/\.dart$/, "")}.dart`], files);
      }
      // A bare specifier ('pages/x.dart') is relative to the importing file's directory.
      return resolveRelative(fromPath, specifier, [".dart"], files);
    }
    default:
      return undefined;
  }
}
