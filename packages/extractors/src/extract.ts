// The extraction engine: run a language's query over a parsed file and normalize
// the captures into FileFacts. The only per-language branch is how a @call node is
// interpreted (callMode); everything else is uniform.

import { Query } from "web-tree-sitter";
import type { Node, Tree } from "web-tree-sitter";

import type { AnchorFact, AnchorRole, CallFact, ExportFact, FileFacts, ImportFact, SymbolFact, SymbolKind } from "./facts.js";
import { specForLanguage, supportedLanguages, type LanguageSpec } from "./languages.js";
import { createParser } from "./runtime.js";

export { supportedLanguages };

export function isExtractable(language: string): boolean {
  return specForLanguage(language) !== undefined;
}

function stripQuotes(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' || first === "'" || first === "`") && last === first) {
      return text.slice(1, -1);
    }
  }
  return text;
}

function namedChildren(node: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) {
      out.push(child);
    }
  }
  return out;
}

function findFirstIdentifier(node: Node): Node | null {
  if (node.type === "identifier") {
    return node;
  }
  for (const child of namedChildren(node)) {
    const found = findFirstIdentifier(child);
    if (found) {
      return found;
    }
  }
  return null;
}

// Most grammars: a call_expression with a `function` and an `arguments` field.
// Only direct string arguments count, so foo(bar('x')) does not attribute 'x' to foo.
// `argStringStarts` (when given) collects the startIndex of each string-literal arg
// node — the structural signal the anchor pass uses to tag role "call-arg".
function extractCallExpression(
  node: Node,
  spec: LanguageSpec & { callMode: { kind: "callExpression" } },
  argStringStarts?: Set<number>
): { callee: string; args: string[] } {
  // `new X(...)` (new_expression) carries the callee in the `constructor` field, not
  // `function` — so a `new CartServiceClient()` reads the same as a plain call.
  const fnNode = node.childForFieldName(spec.callMode.functionField) ?? node.childForFieldName("constructor");
  const callee = fnNode ? fnNode.text : "";
  const argsNode = node.childForFieldName(spec.callMode.argumentsField);
  const args: string[] = [];
  if (argsNode) {
    for (const child of namedChildren(argsNode)) {
      if (spec.stringTypes.includes(child.type)) {
        args.push(stripQuotes(child.text));
        argStringStarts?.add(child.startIndex);
      }
    }
  }
  return { callee, args };
}

// Dart: an `argument_part` (the (...) of an invocation) wrapped in a `selector`.
// The method name is the identifier of the preceding selector; the base call
// (greet('x')) takes the preceding bare identifier.
function extractDartCall(node: Node, spec: LanguageSpec, argStringStarts?: Set<number>): { callee: string; args: string[] } {
  const args: string[] = [];
  const argsNode = namedChildren(node).find((child) => child.type === "arguments");
  if (argsNode) {
    for (const argument of namedChildren(argsNode)) {
      // argument_part > arguments > argument > string_literal
      if (spec.stringTypes.includes(argument.type)) {
        args.push(stripQuotes(argument.text));
        argStringStarts?.add(argument.startIndex);
        continue;
      }
      for (const inner of namedChildren(argument)) {
        if (spec.stringTypes.includes(inner.type)) {
          args.push(stripQuotes(inner.text));
          argStringStarts?.add(inner.startIndex);
        }
      }
    }
  }

  let callee = "";
  const selector = node.parent; // (selector (argument_part ...))
  const prev = selector ? selector.previousNamedSibling : null;
  if (prev) {
    if (prev.type === "identifier") {
      callee = prev.text;
    } else {
      const id = findFirstIdentifier(prev);
      callee = id ? id.text : prev.text;
    }
  }
  return { callee, args };
}

function extractCall(node: Node, spec: LanguageSpec, argStringStarts?: Set<number>): { callee: string; args: string[] } {
  if (spec.callMode.kind === "dartSelector") {
    return extractDartCall(node, spec, argStringStarts);
  }
  return extractCallExpression(node, spec as LanguageSpec & { callMode: { kind: "callExpression" } }, argStringStarts);
}

// Walk the whole tree and collect every string-literal node (per the grammar's
// stringTypes). Role is decided by STRUCTURAL position only — never by reading the
// string's content: a node whose startIndex was recorded as an import specifier is
// "import", one recorded as a call argument is "call-arg", everything else is a bare
// "literal". Precedence import > call-arg > literal, one role per occurrence.
function collectAnchors(
  root: Node,
  spec: LanguageSpec,
  importStringStarts: ReadonlySet<number>,
  argStringStarts: ReadonlySet<number>
): AnchorFact[] {
  const anchors: AnchorFact[] = [];
  const stringTypes = new Set(spec.stringTypes);
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (stringTypes.has(node.type)) {
      let role: AnchorRole = "literal";
      if (importStringStarts.has(node.startIndex)) {
        role = "import";
      } else if (argStringStarts.has(node.startIndex)) {
        role = "call-arg";
      }
      anchors.push({ text: stripQuotes(node.text), line: node.startPosition.row + 1, role });
      // A string literal has no string-literal children worth descending into; for
      // template strings the substitutions are expressions, not anchors we key on.
      continue;
    }
    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i);
      if (child) stack.push(child);
    }
  }
  // Pre-order, stable: reverse the LIFO pushes back into source order by sorting on
  // startIndex so anchors read top-to-bottom regardless of traversal order.
  anchors.sort((a, b) => a.line - b.line);
  return anchors;
}

/**
 * Extract normalized structural facts from a single file. Unsupported languages
 * return empty facts (not an error); parse failures return empty facts with a
 * parseError so the gap is visible rather than silent.
 */
export async function extractFileFacts(path: string, text: string, language: string): Promise<FileFacts> {
  const spec = specForLanguage(language);
  if (!spec) {
    return { path, language, symbols: [], imports: [], calls: [], exports: [], anchors: [] };
  }

  let tree: Tree | null | undefined;
  let query: Query | undefined;
  try {
    const { parser, language: grammar } = await createParser(spec.grammar);
    tree = parser.parse(text);
    if (!tree) {
      return { path, language, symbols: [], imports: [], calls: [], exports: [], anchors: [], parseError: "parse returned null" };
    }
    query = new Query(grammar, spec.query);

    const symbols: SymbolFact[] = [];
    const imports: ImportFact[] = [];
    const calls: CallFact[] = [];
    const exports: ExportFact[] = [];
    // Structural anchor bookkeeping: startIndex of every string node the query saw
    // as an import specifier vs. a call argument. The anchor pass tags role from
    // these positions — no string content is ever inspected for framework tokens.
    const importStringStarts = new Set<number>();
    const argStringStarts = new Set<number>();

    for (const match of query.matches(tree.rootNode)) {
      for (const capture of match.captures) {
        const node = capture.node;
        const line = node.startPosition.row + 1;
        if (capture.name === "import") {
          imports.push({ module: stripQuotes(node.text), line });
          if (spec.stringTypes.includes(node.type)) importStringStarts.add(node.startIndex);
        } else if (capture.name === "reexport") {
          imports.push({ module: stripQuotes(node.text), line, edgeKind: "re-export" });
          if (spec.stringTypes.includes(node.type)) importStringStarts.add(node.startIndex);
        } else if (capture.name === "call") {
          const { callee, args } = extractCall(node, spec, argStringStarts);
          calls.push({ callee, args, line });
          // Call-shaped imports the import_statement query misses: require('x'),
          // dynamic import('x'). The callees that count are declared per language.
          const moduleArg = args[0];
          if (moduleArg !== undefined && spec.importCallees?.includes(callee)) {
            imports.push({ module: moduleArg, line });
          }
        } else if (capture.name === "export") {
          exports.push({ name: node.text, line });
        } else if (capture.name === "export.member") {
          // CommonJS: exports.X = ... / module.exports.X = ...
          const exportName = /^(?:module\.)?exports\.([A-Za-z_$][\w$]*)$/.exec(node.text)?.[1];
          if (exportName) {
            exports.push({ name: exportName, line });
          }
        } else if (capture.name.startsWith("symbol.")) {
          const kind = capture.name.slice("symbol.".length) as SymbolKind;
          symbols.push({ kind, name: node.text, line });
        }
      }
    }

    const anchors = collectAnchors(tree.rootNode, spec, importStringStarts, argStringStarts);
    return { path, language, symbols, imports, calls, exports, anchors };
  } catch (error) {
    return {
      path,
      language,
      symbols: [],
      imports: [],
      calls: [],
      exports: [],
      anchors: [],
      parseError: error instanceof Error ? error.message : String(error)
    };
  } finally {
    query?.delete();
    tree?.delete();
  }
}
