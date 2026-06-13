import assert from "node:assert/strict";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";
import type { RepoFiles } from "@mappamind_/baseline";

import { synthesizeBaseline } from "./synthesize.js";
import { parseProposal } from "./parse.js";
import type { ModelClient } from "./model.js";

function file(partial: Partial<FileFacts> & { path: string; language: string }): FileFacts {
  return { symbols: [], imports: [], calls: [], exports: [], anchors: [], ...partial };
}

const repos: RepoFiles[] = [
  {
    repo: "app",
    files: [
      file({
        path: "src/checkout.ts",
        language: "typescript",
        symbols: [{ kind: "function", name: "checkout", line: 10 }],
        imports: [{ module: "./payments", line: 1 }]
      }),
      file({
        path: "src/payments.ts",
        language: "typescript",
        symbols: [{ kind: "function", name: "charge", line: 5 }]
      })
    ]
  }
];

// A fake model that returns a fixed response — no `claude` process involved.
function fakeClient(response: string): ModelClient {
  return { complete: async () => ({ text: response }) };
}

test("end-to-end: a hallucinating model still yields a grounded baseline", async () => {
  // The model returns one REAL capability and one entirely INVENTED one, in a fenced
  // block with prose around it (the messy reality of model output).
  const response = [
    "Here is the map:",
    "```json",
    JSON.stringify({
      capabilities: [
        { name: "Checkout", summary: "places orders", members: [{ repo: "app", file: "src/checkout.ts", symbol: "checkout" }] },
        { name: "Imaginary Billing", summary: "made up", members: [{ repo: "app", file: "src/nope.ts", symbol: "ghost" }] }
      ],
      edges: [{ from: "Checkout", to: "Payments" }],
      unknowns: [{ note: "unsure how refunds work" }]
    }),
    "```",
    "Hope that helps!"
  ].join("\n");

  const result = await synthesizeBaseline({
    repos,
    client: fakeClient(response),
    workspaceId: "ws1",
    factsHash: "h1"
  });

  // The real capability survives; the invented one is dropped by the leash.
  assert.equal(result.baseline.capabilities.length, 1);
  assert.equal(result.baseline.capabilities[0]!.name, "Checkout");
  assert.equal(result.droppedCapabilities.length, 1);
  assert.equal(result.droppedCapabilities[0]!.name, "Imaginary Billing");

  // The edge references a non-surfaced capability ("Payments") -> dropped.
  assert.equal(result.baseline.edges.length, 0);

  // Unknowns pass through; the model call is logged for the ledger.
  assert.equal(result.baseline.unknowns.length, 1);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]!.label, "synthesize:app");
  assert.equal(result.repoErrors.length, 0);
});

test("a model failure on one repo is recorded, not fatal", async () => {
  const throwing: ModelClient = {
    complete: async () => {
      throw new Error("claude not found");
    }
  };
  const result = await synthesizeBaseline({ repos, client: throwing, workspaceId: "ws1", factsHash: "h1" });
  assert.equal(result.baseline.capabilities.length, 0);
  assert.equal(result.repoErrors.length, 1);
  assert.equal(result.repoErrors[0]!.repo, "app");
});

test("an unparseable response is recorded as a repo error, not a crash", async () => {
  const result = await synthesizeBaseline({
    repos,
    client: fakeClient("I cannot help with that."),
    workspaceId: "ws1",
    factsHash: "h1"
  });
  assert.equal(result.baseline.capabilities.length, 0);
  assert.equal(result.repoErrors.length, 1);
  assert.match(result.repoErrors[0]!.error, /no JSON object/);
});

test("parseProposal recovers JSON from fenced and bare responses", () => {
  const bare = parseProposal('{"capabilities":[{"name":"X","members":[]}],"edges":[],"unknowns":[]}');
  assert.equal(bare.capabilities.length, 1);
  const fenced = parseProposal('```json\n{"capabilities":[],"edges":[],"unknowns":[]}\n```');
  assert.equal(fenced.capabilities.length, 0);
});
