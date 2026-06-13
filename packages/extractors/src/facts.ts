// Normalized structural facts.
//
// This is the language-agnostic contract that the seam detector (M2) and the
// baseline synthesis (M3) consume. Per-language tree-sitter queries map each
// grammar's AST onto these shapes; everything downstream sees only this.

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "enum"
  | "type";

// A declaration: a function, method, class, etc., with its name and location.
export type SymbolFact = {
  readonly kind: SymbolKind;
  readonly name: string;
  readonly line: number; // 1-based start line
};

// A dependency: an imported module/path, quotes stripped.
export type ImportFact = {
  readonly module: string;
  readonly line: number;
  // Set for `export ... from` / Dart `export` edges so downstream can identify
  // barrel files without treating them as ordinary imports.
  readonly edgeKind?: "re-export";
};

// An invocation. `callee` is the (best-effort dotted) callee text; `args` holds
// only string-literal arguments (quotes stripped) because those carry the seam
// signal: httpsCallable('chatStylist'), app.post('/charge'), grpc names, etc.
export type CallFact = {
  readonly callee: string;
  readonly args: readonly string[];
  readonly line: number;
};

// A public surface name: CommonJS exports.X / module.exports.X, or an ESM exported
// declaration. The seam's provider side keys off these (e.g. the callable names a
// backend actually exports).
export type ExportFact = {
  readonly name: string;
  readonly line: number;
};

// Where a string literal sits in the AST — its STRUCTURAL position only. This is
// never a framework judgement: `role` says "this string was an import specifier /
// a call argument / a bare literal", never "this string is an HTTP route". The
// channel tier (and the model above it) decide meaning; this just records shape.
export type AnchorRole = "import" | "call-arg" | "literal"; // structural AST position only — NOT framework
export type AnchorFact = { readonly text: string; readonly line: number; readonly role: AnchorRole; };

// Everything extracted from a single file.
export type FileFacts = {
  readonly path: string;
  readonly language: string;
  readonly symbols: readonly SymbolFact[];
  readonly imports: readonly ImportFact[];
  readonly calls: readonly CallFact[];
  readonly exports: readonly ExportFact[];
  // Every string literal in the file, tagged by structural AST position only. The
  // channel tier consumes these to find identical shared names across services
  // without any framework knowledge living in the extractor.
  readonly anchors: readonly AnchorFact[];
  // Set when the file could not be parsed/extracted. Honest over silent.
  readonly parseError?: string;
};
