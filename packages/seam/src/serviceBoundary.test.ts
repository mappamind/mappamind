import assert from "node:assert/strict";
import test from "node:test";

import type { FileFacts } from "@mappamind_/extractors";

import { detectServiceBoundaries } from "./serviceBoundary.js";

function file(path: string, language = "go"): FileFacts {
  return { path, language, symbols: [], imports: [], calls: [], exports: [], anchors: [] };
}

test("admits services from manifests and container dirs, ignores CI/docs helpers", () => {
  const { services } = detectServiceBoundaries([
    file(".github/workflows/ci.yml", "yaml"),
    file(".github/workflows/install-dependencies.sh", "shell"),
    file(".deploystack/scripts/preinit.sh", "shell"),
    file("docs/architecture.md", "markdown"),
    file("docs/releasing/make-release.sh", "shell"),
    file("kustomize/base/service.yaml", "yaml"),
    file("src/foo/main.go"),
    file("worker/main.go"),
    file("api/src/index.ts", "typescript"),
    file("web/package.json", "json"),
    file("services/billing/package.json", "json")
  ]);
  assert.deepEqual(services, ["api", "services/billing", "src/foo", "web", "worker"]);
});

test("deep source in an admitted root-level service is attributed to it", () => {
  const { services, serviceByPath } = detectServiceBoundaries([
    file("web/package.json", "json"),
    file("web/components/Header.tsx", "typescript"),
    file("src/cart/cart.go")
  ]);
  assert.deepEqual(services, ["src/cart", "web"]);
  assert.equal(serviceByPath.get("web/components/Header.tsx"), "web");
});

test("a lone deep file does not conjure a service", () => {
  const { services } = detectServiceBoundaries([file("random/deep/nested/file.go")]);
  assert.deepEqual(services, []);
});

test("a .proto contract is service-bearing and attributed to its enclosing service", () => {
  // A declarative contract (.proto) is a service's interface, not extractable source —
  // it must still attribute to its service so its declared channel keys reach the
  // surfacer. Without this the cross-service gRPC channel never forms.
  const { serviceByPath } = detectServiceBoundaries([
    file("src/basket/main.go"),
    file("src/basket/Protos/basket.proto", "protobuf"),
    file("src/client/main.go"),
    file("src/client/Protos/basket.proto", "protobuf")
  ]);
  assert.equal(serviceByPath.get("src/basket/Protos/basket.proto"), "src/basket");
  assert.equal(serviceByPath.get("src/client/Protos/basket.proto"), "src/client");
});

test("a co-located .proto under a ROOT-LEVEL service dir is attributed (not just src/<svc>)", () => {
  // Common Go/.NET layout: `basket/proto/x.proto` with no `src/` container. The proto
  // must rescue into its admitted root service or co-located gRPC silently misses.
  const { serviceByPath } = detectServiceBoundaries([
    file("basket/main.go"),
    file("basket/proto/basket.proto", "protobuf"),
    file("client/main.go"),
    file("client/proto/basket.proto", "protobuf")
  ]);
  assert.equal(serviceByPath.get("basket/proto/basket.proto"), "basket");
  assert.equal(serviceByPath.get("client/proto/basket.proto"), "client");
});
