// Language-agnostic file classification.
//
// This replaces the v1 `isSourceLikePath` allowlist, which only matched JS/TS plus
// config and markup and therefore silently dropped every .dart, .go, .py, .cs, and
// .java file. The rule here is inclusive: classify every file by language and
// category, capture everything that carries meaning, and skip only assets and
// binaries. What gets skipped is counted and reported, never dropped in silence.

export type FileCategory =
  | "source" // a programming language we can extract structure from
  | "contract" // an interface/IDL definition (proto, graphql, thrift): the seam
  | "config" // structured configuration or build manifests
  | "markup" // html/css and friends
  | "doc" // human prose
  | "data" // tabular or query data
  | "asset" // binary or media; not read for the model
  | "unknown"; // text we keep but cannot name

export type FileClassification = {
  readonly language: string;
  readonly category: FileCategory;
};

// Per-language file counts in a coverage report.
export type LanguageCoverage = {
  readonly language: string;
  readonly category: FileCategory;
  readonly files: number;
  readonly bytes: number;
};

// Files left out of model capture, grouped by why.
export type SkipCoverage = {
  readonly reason: "asset" | "too_large" | "binary" | "over_cap" | "missing";
  readonly files: number;
};

// The honest answer to "what did you actually read?".
export type CoverageReport = {
  readonly totalListed: number; // text + asset files git listed, after ignore filter
  readonly captured: number; // files read for the model
  readonly truncatedByCap: boolean; // we hit the project-file cap and left some out
  readonly byLanguage: readonly LanguageCoverage[];
  readonly skipped: readonly SkipCoverage[];
};

type Mapping = { readonly language: string; readonly category: FileCategory };

const EXTENSION_MAP: Readonly<Record<string, Mapping>> = {
  // --- programming languages (source) ---
  ts: { language: "typescript", category: "source" },
  tsx: { language: "tsx", category: "source" },
  mts: { language: "typescript", category: "source" },
  cts: { language: "typescript", category: "source" },
  js: { language: "javascript", category: "source" },
  jsx: { language: "javascript", category: "source" },
  mjs: { language: "javascript", category: "source" },
  cjs: { language: "javascript", category: "source" },
  dart: { language: "dart", category: "source" },
  go: { language: "go", category: "source" },
  py: { language: "python", category: "source" },
  pyi: { language: "python", category: "source" },
  rb: { language: "ruby", category: "source" },
  java: { language: "java", category: "source" },
  kt: { language: "kotlin", category: "source" },
  kts: { language: "kotlin", category: "source" },
  cs: { language: "csharp", category: "source" },
  swift: { language: "swift", category: "source" },
  rs: { language: "rust", category: "source" },
  scala: { language: "scala", category: "source" },
  sc: { language: "scala", category: "source" },
  php: { language: "php", category: "source" },
  c: { language: "c", category: "source" },
  h: { language: "c", category: "source" },
  cc: { language: "cpp", category: "source" },
  cpp: { language: "cpp", category: "source" },
  cxx: { language: "cpp", category: "source" },
  hpp: { language: "cpp", category: "source" },
  hh: { language: "cpp", category: "source" },
  m: { language: "objc", category: "source" },
  mm: { language: "objc", category: "source" },
  ex: { language: "elixir", category: "source" },
  exs: { language: "elixir", category: "source" },
  erl: { language: "erlang", category: "source" },
  clj: { language: "clojure", category: "source" },
  cljs: { language: "clojure", category: "source" },
  hs: { language: "haskell", category: "source" },
  lua: { language: "lua", category: "source" },
  r: { language: "r", category: "source" },
  jl: { language: "julia", category: "source" },
  groovy: { language: "groovy", category: "source" },
  vue: { language: "vue", category: "source" },
  svelte: { language: "svelte", category: "source" },
  sh: { language: "shell", category: "source" },
  bash: { language: "shell", category: "source" },
  zsh: { language: "shell", category: "source" },
  sql: { language: "sql", category: "source" },
  // infrastructure as code is structural source, not inert config
  tf: { language: "terraform", category: "source" },
  tfvars: { language: "terraform", category: "source" },
  hcl: { language: "hcl", category: "source" },

  // --- interface / contract definitions (the seam) ---
  proto: { language: "protobuf", category: "contract" },
  graphql: { language: "graphql", category: "contract" },
  gql: { language: "graphql", category: "contract" },
  thrift: { language: "thrift", category: "contract" },

  // --- configuration / build manifests ---
  json: { language: "json", category: "config" },
  jsonc: { language: "json", category: "config" },
  yaml: { language: "yaml", category: "config" },
  yml: { language: "yaml", category: "config" },
  toml: { language: "toml", category: "config" },
  ini: { language: "ini", category: "config" },
  cfg: { language: "ini", category: "config" },
  conf: { language: "ini", category: "config" },
  properties: { language: "properties", category: "config" },
  xml: { language: "xml", category: "config" },
  gradle: { language: "gradle", category: "config" },
  env: { language: "dotenv", category: "config" },

  // --- markup / styling ---
  html: { language: "html", category: "markup" },
  htm: { language: "html", category: "markup" },
  css: { language: "css", category: "markup" },
  scss: { language: "scss", category: "markup" },
  sass: { language: "scss", category: "markup" },
  less: { language: "less", category: "markup" },

  // --- prose ---
  md: { language: "markdown", category: "doc" },
  mdx: { language: "markdown", category: "doc" },
  markdown: { language: "markdown", category: "doc" },
  rst: { language: "rst", category: "doc" },
  txt: { language: "text", category: "doc" },

  // --- data ---
  csv: { language: "csv", category: "data" },
  tsv: { language: "csv", category: "data" },

  // --- assets / binaries (skipped, but counted) ---
  png: { language: "binary", category: "asset" },
  jpg: { language: "binary", category: "asset" },
  jpeg: { language: "binary", category: "asset" },
  gif: { language: "binary", category: "asset" },
  webp: { language: "binary", category: "asset" },
  bmp: { language: "binary", category: "asset" },
  ico: { language: "binary", category: "asset" },
  svg: { language: "binary", category: "asset" },
  woff: { language: "binary", category: "asset" },
  woff2: { language: "binary", category: "asset" },
  ttf: { language: "binary", category: "asset" },
  otf: { language: "binary", category: "asset" },
  eot: { language: "binary", category: "asset" },
  mp4: { language: "binary", category: "asset" },
  mov: { language: "binary", category: "asset" },
  webm: { language: "binary", category: "asset" },
  mp3: { language: "binary", category: "asset" },
  wav: { language: "binary", category: "asset" },
  pdf: { language: "binary", category: "asset" },
  zip: { language: "binary", category: "asset" },
  gz: { language: "binary", category: "asset" },
  tar: { language: "binary", category: "asset" },
  jar: { language: "binary", category: "asset" },
  war: { language: "binary", category: "asset" },
  class: { language: "binary", category: "asset" },
  so: { language: "binary", category: "asset" },
  dylib: { language: "binary", category: "asset" },
  dll: { language: "binary", category: "asset" },
  exe: { language: "binary", category: "asset" },
  bin: { language: "binary", category: "asset" },
  wasm: { language: "binary", category: "asset" },
  pyc: { language: "binary", category: "asset" },
  db: { language: "binary", category: "asset" },
  sqlite: { language: "binary", category: "asset" },
  keystore: { language: "binary", category: "asset" },
  jks: { language: "binary", category: "asset" }
};

// Files identified by exact name rather than extension.
const FILENAME_MAP: Readonly<Record<string, Mapping>> = {
  dockerfile: { language: "dockerfile", category: "source" },
  makefile: { language: "make", category: "config" },
  "go.sum": { language: "checksum", category: "data" },
  ".ds_store": { language: "binary", category: "asset" }
};

function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/**
 * Classify a repository-relative path by language and category. Unknown text
 * files are returned as `{ language: "unknown", category: "unknown" }` so they are
 * still captured and counted, never silently discarded.
 */
export function classifyFile(path: string): FileClassification {
  const name = basename(path).toLowerCase();

  const byName = FILENAME_MAP[name];
  if (byName) {
    return byName;
  }

  // Use the final extension. Compound names like Cart.proto or user.g.dart resolve
  // to their last segment (proto, dart), which is the language that matters.
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1);
    const byExt = EXTENSION_MAP[ext];
    if (byExt) {
      return byExt;
    }
  }

  return { language: "unknown", category: "unknown" };
}

/**
 * Whether a file should be read into the model. Everything textual is in; only
 * assets and binaries are out. The binary-content check in the reader is the
 * backstop for anything mislabeled here.
 */
export function shouldCaptureForModel(classification: FileClassification): boolean {
  return classification.category !== "asset";
}
