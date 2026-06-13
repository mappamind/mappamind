// tree-sitter WASM runtime: one-time init, plus cached grammar loading.
//
// web-tree-sitter is an Emscripten module. In Node it needs `locateFile` to find
// the core tree-sitter.wasm next to the package. Grammar wasms come prebuilt from
// tree-sitter-wasms and are resolved by package subpath.

import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { Language, Parser } from "web-tree-sitter";

const require = createRequire(import.meta.url);

let initPromise: Promise<void> | undefined;
const grammarCache = new Map<string, Language>();

async function ensureInit(): Promise<void> {
  if (!initPromise) {
    const webTreeSitterDir = dirname(require.resolve("web-tree-sitter"));
    initPromise = Parser.init({
      locateFile: (name: string) => join(webTreeSitterDir, name)
    });
  }
  await initPromise;
}

/**
 * Load (and cache) a prebuilt grammar by its tree-sitter-wasms stem, e.g. "go",
 * "typescript", "dart". Grammars are loaded from wasm bytes, which is the reliable
 * path in Node.
 */
export async function loadGrammar(grammarStem: string): Promise<Language> {
  await ensureInit();
  const cached = grammarCache.get(grammarStem);
  if (cached) {
    return cached;
  }
  const wasmPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${grammarStem}.wasm`);
  const bytes = new Uint8Array(await readFile(wasmPath));
  const language = await Language.load(bytes);
  grammarCache.set(grammarStem, language);
  return language;
}

/** Create a parser bound to a loaded grammar. Parsers are cheap; grammars are cached. */
export async function createParser(grammarStem: string): Promise<{ parser: Parser; language: Language }> {
  const language = await loadGrammar(grammarStem);
  const parser = new Parser();
  parser.setLanguage(language);
  return { parser, language };
}
