export { extractFileFacts, isExtractable, supportedLanguages } from "./extract.js";
export type {
  AnchorFact,
  AnchorRole,
  CallFact,
  ExportFact,
  FileFacts,
  ImportFact,
  SymbolFact,
  SymbolKind
} from "./facts.js";
export { loadGrammar, createParser } from "./runtime.js";
