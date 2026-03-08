import { environment } from "@raycast/api";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import { CatalogDiskManifest } from "./types.js";

export interface CatalogPaths {
  rootDir: string;
  manifestPath: string;
  globalScenariosPath: string;
  orgsDir: string;
}

const CURRENT_SCHEMA_VERSION = 2;

export const CATALOG_DIR = join(environment.supportPath, "catalog");
export const ACTIVE_DIR = join(CATALOG_DIR, "active");
export const WORK_ROOT_DIR = join(CATALOG_DIR, "work");
export const LOCK_PATH = join(CATALOG_DIR, "sync.lock");

const LEGACY_MANIFEST_PATH = join(CATALOG_DIR, "manifest.json");
const LEGACY_GLOBAL_SCENARIOS_PATH = join(CATALOG_DIR, "scenarios.all.jsonl");
const LEGACY_ORGS_DIR = join(CATALOG_DIR, "orgs");

const manifestCache = new Map<string, CatalogDiskManifest | null>();

function normalizeManifest(
  raw: Partial<CatalogDiskManifest> | null,
): CatalogDiskManifest | null {
  if (!raw) {
    return null;
  }

  return {
    schemaVersion: raw.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    version: raw.version ?? 0,
    lastSuccessfulSyncAt: raw.lastSuccessfulSyncAt ?? null,
    currentUserId: raw.currentUserId ?? null,
    indexedScenarioCount:
      raw.indexedScenarioCount ?? raw.defaultScenarioRows?.length ?? 0,
    indexedOrgKeys: raw.indexedOrgKeys ?? [],
    enrichmentPendingOrgKeys: raw.enrichmentPendingOrgKeys ?? [],
    organizationLastEditTs: raw.organizationLastEditTs ?? {},
    defaultScenarioRows: raw.defaultScenarioRows ?? [],
    organizationRows: raw.organizationRows ?? [],
    facets: raw.facets ?? {
      organizations: [],
      teamsByOrg: {},
    },
    skippedOrgs: raw.skippedOrgs ?? [],
  };
}

export function getCatalogPaths(rootDir: string): CatalogPaths {
  return {
    rootDir,
    manifestPath: join(rootDir, "manifest.json"),
    globalScenariosPath: join(rootDir, "scenarios.all.jsonl"),
    orgsDir: join(rootDir, "orgs"),
  };
}

export function ensureCatalogDirectories() {
  mkdirSync(environment.supportPath, { recursive: true });
  mkdirSync(CATALOG_DIR, { recursive: true });
  mkdirSync(WORK_ROOT_DIR, { recursive: true });
}

export function getActiveCatalogPaths(): CatalogPaths {
  return getCatalogPaths(ACTIVE_DIR);
}

export function createWorkCatalogPaths(syncId: string): CatalogPaths {
  return getCatalogPaths(join(WORK_ROOT_DIR, syncId));
}

export function getOrgShardPath(rootDir: string, orgKey: string): string {
  return join(
    getCatalogPaths(rootDir).orgsDir,
    `${encodeURIComponent(orgKey)}.jsonl`,
  );
}

export function readCatalogManifest(
  rootDir: string,
): CatalogDiskManifest | null {
  if (manifestCache.has(rootDir)) {
    return manifestCache.get(rootDir) ?? null;
  }

  const { manifestPath } = getCatalogPaths(rootDir);
  if (!existsSync(manifestPath)) {
    manifestCache.set(rootDir, null);
    return null;
  }

  try {
    const parsed = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as Partial<CatalogDiskManifest>;
    const normalized = normalizeManifest(parsed);
    manifestCache.set(rootDir, normalized);
    return normalized;
  } catch {
    manifestCache.set(rootDir, null);
    return null;
  }
}

export function readActiveManifest(): CatalogDiskManifest | null {
  return readCatalogManifest(ACTIVE_DIR);
}

export function catalogHasData(rootDir: string): boolean {
  const { manifestPath, globalScenariosPath } = getCatalogPaths(rootDir);
  return existsSync(manifestPath) && existsSync(globalScenariosPath);
}

export function getLatestWorkCatalogRoot(): string | null {
  if (!existsSync(WORK_ROOT_DIR)) {
    return null;
  }

  const roots = readdirSync(WORK_ROOT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(WORK_ROOT_DIR, entry.name))
    .filter((rootDir) => readCatalogManifest(rootDir) !== null)
    .sort((a, b) => b.localeCompare(a));

  return roots[0] ?? null;
}

export function getPreferredCatalogRoot(): string | null {
  if (catalogHasData(ACTIVE_DIR)) {
    return ACTIVE_DIR;
  }

  return getLatestWorkCatalogRoot();
}

export function getPreferredCatalogPaths(): CatalogPaths | null {
  const rootDir = getPreferredCatalogRoot();
  return rootDir ? getCatalogPaths(rootDir) : null;
}

export function clearCatalogManifestCache(rootDir?: string) {
  if (rootDir) {
    manifestCache.delete(rootDir);
    return;
  }

  manifestCache.clear();
}

export function migrateLegacyCatalogIfNeeded() {
  ensureCatalogDirectories();

  if (
    catalogHasData(ACTIVE_DIR) ||
    !existsSync(LEGACY_MANIFEST_PATH) ||
    !existsSync(LEGACY_GLOBAL_SCENARIOS_PATH)
  ) {
    return;
  }

  const activePaths = getActiveCatalogPaths();
  mkdirSync(activePaths.rootDir, { recursive: true });

  try {
    if (existsSync(LEGACY_ORGS_DIR)) {
      renameSync(LEGACY_ORGS_DIR, activePaths.orgsDir);
    }
  } catch {
    // Ignore legacy migration failures and fall back to a fresh sync.
  }

  try {
    renameSync(LEGACY_MANIFEST_PATH, activePaths.manifestPath);
    renameSync(LEGACY_GLOBAL_SCENARIOS_PATH, activePaths.globalScenariosPath);
  } catch {
    // Ignore legacy migration failures and fall back to a fresh sync.
  }

  clearCatalogManifestCache();
}
