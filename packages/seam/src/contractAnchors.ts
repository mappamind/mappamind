// Declarative-contract anchors (plan Phase 2.4 / C-source). Open standards — proto
// and OpenAPI — ARE cross-service contracts: machine-readable, directional, present
// in exactly the polyglot repos we target. Reading a `.proto`/OpenAPI spec is reading
// a contract, NOT pattern-matching a framework idiom (§I1) — these are interchange
// formats, language-agnostic by definition.
//
// We extract grounded channel KEYS (route / service.method) with their line, as plain
// anchors. They flow through the SAME surfacer/verifier as string anchors: a route a
// spec declares in service A, referenced as a URL string in service B, becomes one
// cross-service candidate — with the producer side authoritatively grounded.

export type ContractAnchor = { readonly line: number; readonly text: string };

// Is this a contract file we can read? Keyed on filename/extension only (format
// detection is file-level and universal — acceptable per the reviews), never on content.
export function isContractFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower.endsWith(".proto")) return true;
  if (/(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/.test(lower)) return true;
  return false;
}

export function contractKeyAnchors(path: string, text: string): ContractAnchor[] {
  const lower = path.toLowerCase();
  if (lower.endsWith(".proto")) return protoAnchors(text);
  if (/(^|\/)(openapi|swagger)[^/]*\.(ya?ml|json)$/.test(lower)) return openapiPathAnchors(text);
  return [];
}

// proto: a `service Foo { rpc Bar(...) }` declares channel `foo/bar` — two segments,
// so it survives the universal ≥2-segment key rule. Tracks the enclosing service.
function protoAnchors(text: string): ContractAnchor[] {
  const out: ContractAnchor[] = [];
  const lines = text.split("\n");
  let service = "";
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const svc = /^\s*service\s+([A-Za-z_]\w*)/.exec(line);
    if (svc) {
      service = svc[1]!;
      continue;
    }
    const rpc = /^\s*rpc\s+([A-Za-z_]\w*)/.exec(line);
    if (rpc && service) out.push({ line: i + 1, text: `${service}/${rpc[1]}` });
  }
  return out;
}

// OpenAPI: the keys under `paths:` are the routes. Line-scan handles both YAML and
// JSON without a positioned parser: a path key is a string that starts with "/".
function openapiPathAnchors(text: string): ContractAnchor[] {
  const out: ContractAnchor[] = [];
  const lines = text.split("\n");
  let inPaths = false;
  let pathsIndent = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const indent = line.length - line.trimStart().length;
    if (/^\s*"?paths"?\s*:/.test(line)) {
      inPaths = true;
      pathsIndent = indent;
      continue;
    }
    if (!inPaths) continue;
    const trimmed = line.trim();
    // Left the paths block (a sibling/parent key at the same-or-shallower indent).
    if (trimmed.length > 0 && indent <= pathsIndent && !trimmed.startsWith("/") && !/^"\//.test(trimmed)) {
      inPaths = false;
      continue;
    }
    const key = /^\s*"?(\/[^"\s:]*)"?\s*:/.exec(line);
    if (key) out.push({ line: i + 1, text: key[1]! });
  }
  return out;
}
