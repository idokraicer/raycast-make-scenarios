import { environment } from "@raycast/api";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CatalogDiskManifest } from "./types.js";

export const CATALOG_DIR = join(environment.supportPath, "catalog");
export const ORGS_DIR = join(CATALOG_DIR, "orgs");
export const MANIFEST_PATH = join(CATALOG_DIR, "manifest.json");
export const GLOBAL_SCENARIOS_PATH = join(CATALOG_DIR, "scenarios.all.jsonl");
export const LOCK_PATH = join(CATALOG_DIR, "sync.lock");

let manifestCache: CatalogDiskManifest | null = null;

export function ensureCatalogDirectories() {
  mkdirSync(environment.supportPath, { recursive: true });
  mkdirSync(CATALOG_DIR, { recursive: true });
}

export function getOrgShardPath(orgKey: string): string {
  return join(ORGS_DIR, `${encodeURIComponent(orgKey)}.jsonl`);
}

export function readDiskManifest(): CatalogDiskManifest | null {
  if (manifestCache) {
    return manifestCache;
  }

  if (!existsSync(MANIFEST_PATH)) {
    return null;
  }

  try {
    manifestCache = JSON.parse(
      readFileSync(MANIFEST_PATH, "utf8"),
    ) as CatalogDiskManifest;
    return manifestCache;
  } catch {
    return null;
  }
}

export function clearDiskManifestCache() {
  manifestCache = null;
}
