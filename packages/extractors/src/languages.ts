// Per-language extraction specs.
//
// Each spec pairs a prebuilt grammar with a tree-sitter query whose captures are
// normalized downstream: @import (a module string), @reexport (a barrel module
// string), @symbol.<kind> (a name node), and @call (an invocation node). Calls
// are interpreted per `callMode` because
// grammars model invocation differently (most use call_expression; Dart uses a
// selector with an argument_part). Adding a language = adding one spec here.

export type CallMode =
  | { readonly kind: "callExpression"; readonly functionField: string; readonly argumentsField: string }
  | { readonly kind: "dartSelector" };

export type LanguageSpec = {
  readonly grammar: string; // tree-sitter-wasms stem
  readonly query: string; // captures: @import, @symbol.<kind>, @call
  readonly callMode: CallMode;
  readonly stringTypes: readonly string[]; // grammar node types that are string literals
  // Callees whose first string argument is also a module import — the call-shaped
  // import forms a grammar's import_statement query misses. Declarative, not a code
  // path: e.g. CommonJS require('x') and dynamic import('x') in JS/TS.
  readonly importCallees?: readonly string[];
};

const STRING_TS = ["string", "template_string"];
const STRING_GO = ["interpreted_string_literal", "raw_string_literal"];
const STRING_DART = ["string_literal"];

const CALL_EXPRESSION = { kind: "callExpression", functionField: "function", argumentsField: "arguments" } as const;
// Java models a call as method_invocation with the callee in the `name` field.
const CALL_NAME = { kind: "callExpression", functionField: "name", argumentsField: "arguments" } as const;
// Ruby models a call with the callee in the `method` field.
const CALL_METHOD = { kind: "callExpression", functionField: "method", argumentsField: "arguments" } as const;

const SPECS: Readonly<Record<string, LanguageSpec>> = {
  typescript: {
    grammar: "typescript",
    query: `
      (import_statement source: (string) @import)
      (export_statement source: (string) @reexport)
      (function_declaration name: (identifier) @symbol.function)
      (method_definition name: (property_identifier) @symbol.method)
      (class_declaration name: (type_identifier) @symbol.class)
      (interface_declaration name: (type_identifier) @symbol.interface)
      (enum_declaration name: (identifier) @symbol.enum)
      (export_statement declaration: (function_declaration name: (identifier) @export))
      (export_statement declaration: (class_declaration name: (type_identifier) @export))
      (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @export)))
      (assignment_expression left: (member_expression) @export.member)
      (call_expression) @call
      (new_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: STRING_TS,
    importCallees: ["require", "import"]
  },
  javascript: {
    grammar: "javascript",
    query: `
      (import_statement source: (string) @import)
      (export_statement source: (string) @reexport)
      (function_declaration name: (identifier) @symbol.function)
      (method_definition name: (property_identifier) @symbol.method)
      (class_declaration name: (identifier) @symbol.class)
      (export_statement declaration: (function_declaration name: (identifier) @export))
      (export_statement declaration: (class_declaration name: (identifier) @export))
      (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @export)))
      (assignment_expression left: (member_expression) @export.member)
      (call_expression) @call
      (new_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: STRING_TS,
    importCallees: ["require", "import"]
  },
  go: {
    grammar: "go",
    query: `
      (import_spec path: (interpreted_string_literal) @import)
      (function_declaration name: (identifier) @symbol.function)
      (method_declaration name: (field_identifier) @symbol.method)
      (type_spec name: (type_identifier) @symbol.type)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: STRING_GO
  },
  dart: {
    grammar: "dart",
    query: `
      (import_specification (configurable_uri (uri (string_literal) @import)))
      (library_export (configurable_uri (uri (string_literal) @reexport)))
      (class_definition name: (identifier) @symbol.class)
      (function_signature name: (identifier) @symbol.function)
      (argument_part) @call
    `,
    callMode: { kind: "dartSelector" },
    stringTypes: STRING_DART
  },
  // Frontend: .tsx uses the JSX-capable grammar (the plain typescript grammar
  // chokes on JSX). Same node types as typescript, so the same query.
  tsx: {
    grammar: "tsx",
    query: `
      (import_statement source: (string) @import)
      (export_statement source: (string) @reexport)
      (function_declaration name: (identifier) @symbol.function)
      (method_definition name: (property_identifier) @symbol.method)
      (class_declaration name: (type_identifier) @symbol.class)
      (interface_declaration name: (type_identifier) @symbol.interface)
      (enum_declaration name: (identifier) @symbol.enum)
      (export_statement declaration: (function_declaration name: (identifier) @export))
      (export_statement declaration: (class_declaration name: (type_identifier) @export))
      (export_statement declaration: (lexical_declaration (variable_declarator name: (identifier) @export)))
      (call_expression) @call
      (new_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: STRING_TS,
    importCallees: ["require", "import"]
  },
  python: {
    grammar: "python",
    query: `
      (import_statement name: (dotted_name) @import)
      (import_from_statement module_name: (dotted_name) @import)
      (function_definition name: (identifier) @symbol.function)
      (class_definition name: (identifier) @symbol.class)
      (call) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string"]
  },
  java: {
    grammar: "java",
    query: `
      (import_declaration (scoped_identifier) @import)
      (class_declaration name: (identifier) @symbol.class)
      (interface_declaration name: (identifier) @symbol.interface)
      (enum_declaration name: (identifier) @symbol.enum)
      (method_declaration name: (identifier) @symbol.method)
      (method_invocation) @call
    `,
    callMode: CALL_NAME,
    stringTypes: ["string_literal"]
  },
  csharp: {
    grammar: "c_sharp",
    query: `
      (using_directive (qualified_name) @import)
      (using_directive (identifier) @import)
      (class_declaration name: (identifier) @symbol.class)
      (interface_declaration name: (identifier) @symbol.interface)
      (struct_declaration name: (identifier) @symbol.type)
      (enum_declaration name: (identifier) @symbol.enum)
      (method_declaration name: (identifier) @symbol.method)
      (invocation_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string_literal"]
  },
  c: {
    grammar: "c",
    query: `
      (preproc_include path: (string_literal) @import)
      (preproc_include path: (system_lib_string) @import)
      (function_declarator declarator: (identifier) @symbol.function)
      (struct_specifier name: (type_identifier) @symbol.type)
      (enum_specifier name: (type_identifier) @symbol.enum)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string_literal"]
  },
  cpp: {
    grammar: "cpp",
    query: `
      (preproc_include path: (string_literal) @import)
      (preproc_include path: (system_lib_string) @import)
      (function_declarator declarator: (identifier) @symbol.function)
      (class_specifier name: (type_identifier) @symbol.class)
      (struct_specifier name: (type_identifier) @symbol.type)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string_literal", "raw_string_literal"]
  },
  php: {
    grammar: "php",
    query: `
      (namespace_use_clause (qualified_name) @import)
      (function_definition name: (name) @symbol.function)
      (method_declaration name: (name) @symbol.method)
      (class_declaration name: (name) @symbol.class)
      (interface_declaration name: (name) @symbol.interface)
      (function_call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string", "encapsed_string"]
  },
  ruby: {
    grammar: "ruby",
    query: `
      (method name: (identifier) @symbol.method)
      (class name: (constant) @symbol.class)
      (module name: (constant) @symbol.class)
      (call) @call
    `,
    callMode: CALL_METHOD,
    stringTypes: ["string"],
    importCallees: ["require", "require_relative"]
  },
  rust: {
    grammar: "rust",
    query: `
      (use_declaration argument: (scoped_identifier) @import)
      (use_declaration argument: (identifier) @import)
      (function_item name: (identifier) @symbol.function)
      (struct_item name: (type_identifier) @symbol.type)
      (enum_item name: (type_identifier) @symbol.enum)
      (trait_item name: (type_identifier) @symbol.interface)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string_literal", "raw_string_literal"]
  },
  kotlin: {
    grammar: "kotlin",
    query: `
      (import_header (identifier) @import)
      (function_declaration (simple_identifier) @symbol.function)
      (class_declaration (type_identifier) @symbol.class)
      (object_declaration (type_identifier) @symbol.class)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["line_string_literal", "string_literal"]
  },
  swift: {
    grammar: "swift",
    query: `
      (import_declaration (identifier) @import)
      (function_declaration name: (simple_identifier) @symbol.function)
      (class_declaration name: (type_identifier) @symbol.class)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["line_string_literal"]
  },
  scala: {
    grammar: "scala",
    query: `
      (import_declaration (stable_identifier) @import)
      (import_declaration (identifier) @import)
      (function_definition name: (identifier) @symbol.function)
      (class_definition name: (identifier) @symbol.class)
      (object_definition name: (identifier) @symbol.class)
      (trait_definition name: (identifier) @symbol.interface)
      (call_expression) @call
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string"]
  },
  bash: {
    grammar: "bash",
    query: `
      (function_definition name: (word) @symbol.function)
    `,
    callMode: CALL_EXPRESSION,
    stringTypes: ["string", "raw_string"]
  }
};

// classifyFile() language ids -> spec keys. The capture classifier already maps
// extensions to these ids (csharp, shell, ...); here we wire each to its grammar.
const LANGUAGE_TO_SPEC: Readonly<Record<string, string>> = {
  typescript: "typescript",
  javascript: "javascript",
  tsx: "tsx",
  go: "go",
  dart: "dart",
  python: "python",
  java: "java",
  csharp: "csharp",
  c: "c",
  cpp: "cpp",
  php: "php",
  ruby: "ruby",
  rust: "rust",
  kotlin: "kotlin",
  swift: "swift",
  scala: "scala",
  shell: "bash"
};

export function specForLanguage(language: string): LanguageSpec | undefined {
  const key = LANGUAGE_TO_SPEC[language];
  return key ? SPECS[key] : undefined;
}

export function supportedLanguages(): readonly string[] {
  return Object.keys(LANGUAGE_TO_SPEC);
}
