// Service boundary detection — FROZEN (plan C3, kill-list).
//
// This finds the DEPLOYABLE UNITS (services) a file belongs to, from ecosystem-
// standard manifest filenames (go.mod, package.json, …) and documented monorepo
// container dirs (src/<svc>, packages/<svc>). This is NOT channel recognition and
// NOT a catcher: reading `go.mod` to learn a module exists is standard interchange,
// like any tool. Boundaries may be fuzzy, but they create no false EDGES (edges come
// only from verified channels), so they are not trust-critical.
//
// DO NOT GROW the dir-name lists to chase frameworks — that is the catcher wedge.
// New channel coverage is a prompt (the model), never a new entry here.

import { isExtractable, type FileFacts } from "@mappamind_/extractors";

import { isContractFile } from "./contractAnchors.js";

const CONTAINER_ROOTS = new Set(["src", "services", "service", "apps", "app", "packages", "cmd", "internal"]);
const SERVICE_MANIFESTS = new Set([
  "package.json",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "Dockerfile"
]);
const NESTED_SOURCE_ROOTS = new Set(["src", "lib", "internal", "cmd", "app", "apps"]);

function isServiceManifestPath(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  const name = segments[segments.length - 1];
  return segments.length >= 2 && name !== undefined && SERVICE_MANIFESTS.has(name);
}

export function isServiceBearingFile(file: FileFacts): boolean {
  // Declarative contracts (.proto / OpenAPI) are a service's interface — service-
  // bearing like source, so their declared channel keys reach the surfacer. This is
  // the universal contract category (contractAnchors.ts), NOT a per-framework dir rule.
  return isExtractable(file.language) || isServiceManifestPath(file.path) || isContractFile(file.path);
}

function serviceFromManifestPath(path: string): string | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2 && CONTAINER_ROOTS.has(segments[0]!)) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (segments.length === 2) {
    return segments[0] ?? null;
  }
  return null;
}

// A service = a deployable unit. Prefer explicit monorepo containers (src/<svc>,
// packages/<svc>) and service manifests. For root-level services, only admit source
// near the candidate root so CI/docs helper scripts do not become fake services.
export function serviceOf(file: FileFacts): string | null {
  const segments = file.path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length >= 2 && CONTAINER_ROOTS.has(segments[0]!)) {
    return `${segments[0]}/${segments[1]}`;
  }
  if (isServiceManifestPath(file.path)) {
    return serviceFromManifestPath(file.path);
  }
  if (!isExtractable(file.language)) return null;
  if (segments.length === 2) {
    return segments[0] ?? null;
  }
  if (segments.length >= 3 && NESTED_SOURCE_ROOTS.has(segments[1]!)) {
    return segments[0] ?? null;
  }
  return null;
}

export type ServiceBoundaries = {
  readonly services: readonly string[];
  // every service-bearing file -> the service it belongs to
  readonly serviceByPath: ReadonlyMap<string, string>;
};

// Attribute every service-bearing file to a service. Two passes: admit services by
// the strict rule (manifest / source near a candidate root), then rescue deep source
// whose top-level dir is an already-admitted root-level service (so a lone deep file
// never conjures a service, but a real service's deep files aren't orphaned).
export function detectServiceBoundaries(files: readonly FileFacts[]): ServiceBoundaries {
  const admitted = new Set<string>();
  for (const file of files) {
    if (!isServiceBearingFile(file)) continue;
    const service = serviceOf(file);
    if (service) admitted.add(service);
  }
  const rootServices = new Set([...admitted].filter((name) => !name.includes("/")));

  const serviceByPath = new Map<string, string>();
  for (const file of files) {
    if (!isServiceBearingFile(file)) continue;
    const direct = serviceOf(file);
    if (direct) {
      serviceByPath.set(file.path, direct);
      continue;
    }
    // Rescue deep source — and co-located contract files (a `.proto` under a
    // root-level service dir, e.g. `basket/proto/x.proto`) — into their admitted
    // service. Without this, co-located gRPC only attributes under `src/<svc>` layouts.
    if (isExtractable(file.language) || isContractFile(file.path)) {
      const top = file.path.split("/").filter(Boolean)[0];
      if (top && rootServices.has(top)) serviceByPath.set(file.path, top);
    }
  }

  const services = new Set<string>(serviceByPath.values());
  return { services: [...services].sort(), serviceByPath };
}
