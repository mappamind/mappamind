import assert from "node:assert/strict";
import test from "node:test";

import { contractKeyAnchors, isContractFile, normKey } from "./index.js";

test("isContractFile recognizes proto and openapi/swagger specs only", () => {
  assert.equal(isContractFile("proto/cart.proto"), true);
  assert.equal(isContractFile("api/openapi.yaml"), true);
  assert.equal(isContractFile("docs/swagger.json"), true);
  assert.equal(isContractFile("src/index.ts"), false);
  assert.equal(isContractFile("config.yaml"), false); // a bare yaml is not a contract
});

test("proto: service + rpc becomes a structured service/method key", () => {
  const proto = ["service CartService {", "  rpc GetCart (Req) returns (Res);", "  rpc AddItem (Req) returns (Res);", "}"].join("\n");
  const anchors = contractKeyAnchors("cart.proto", proto);
  assert.deepEqual(anchors.map((a) => a.text), ["CartService/GetCart", "CartService/AddItem"]);
  // and the key survives universal normalization (≥2 segments)
  assert.equal(normKey(anchors[0]!.text), "cartservice/getcart");
});

test("openapi (yaml): the keys under paths are the routes", () => {
  const yaml = [
    "openapi: 3.0.0",
    "paths:",
    "  /v1/items/by-ids:",
    "    get: {}",
    "  /v1/items/{id}:",
    "    get: {}",
    "components:",
    "  schemas: {}"
  ].join("\n");
  const anchors = contractKeyAnchors("openapi.yaml", yaml);
  assert.deepEqual(anchors.map((a) => a.text), ["/v1/items/by-ids", "/v1/items/{id}"]);
  // a spec route and a consumer's interpolated URL normalize to the same key
  assert.equal(normKey("/v1/items/{id}"), normKey("/v1/items/${itemId}"));
});

test("openapi (json): paths keys are extracted, non-path keys ignored", () => {
  const json = '{\n  "openapi": "3.0.0",\n  "paths": {\n    "/orders": { "post": {} },\n    "/orders/{id}": { "get": {} }\n  }\n}';
  const anchors = contractKeyAnchors("swagger.json", json);
  assert.deepEqual(anchors.map((a) => a.text), ["/orders", "/orders/{id}"]);
});
