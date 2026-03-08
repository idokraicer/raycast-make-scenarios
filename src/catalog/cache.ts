import { Cache } from "@raycast/api";
import { CatalogHotStartManifest, CatalogSyncStatus } from "./types.js";

const cache = new Cache({ capacity: 2_000_000 });

const HOT_START_KEY = "catalog-hot-start-v2";
const VERSION_KEY = "catalog-version-v2";
const SYNC_STATUS_KEY = "catalog-sync-status-v2";

let hotStartCache: {
  raw: string | undefined;
  value: CatalogHotStartManifest | null;
} | null = null;
let syncStatusCache: {
  raw: string | undefined;
  value: CatalogSyncStatus | null;
} | null = null;

function parseJson<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function normalizeHotStartManifest(
  raw: CatalogHotStartManifest | null,
): CatalogHotStartManifest | null {
  if (!raw) {
    return null;
  }

  return {
    version: raw.version ?? 0,
    lastSuccessfulSyncAt: raw.lastSuccessfulSyncAt ?? null,
    isPartial: raw.isPartial ?? false,
    indexedScenarioCount:
      raw.indexedScenarioCount ?? raw.defaultScenarioRows?.length ?? 0,
    defaultScenarioRows: raw.defaultScenarioRows ?? [],
    pinnedRows: raw.pinnedRows ?? [],
    recentRows: raw.recentRows ?? [],
    organizationRows: raw.organizationRows ?? [],
    facets: raw.facets ?? {
      organizations: [],
      teamsByOrg: {},
    },
    skippedOrgs: raw.skippedOrgs ?? [],
  };
}

function normalizeCatalogSyncStatus(
  raw: CatalogSyncStatus | null,
): CatalogSyncStatus {
  return (
    raw ?? {
      status: "idle",
      phase: "idle",
      message: "",
      completedOrganizations: 0,
      totalOrganizations: 0,
      completedScenarios: 0,
      lastSuccessfulSyncAt: getHotStartManifest()?.lastSuccessfulSyncAt ?? null,
      updatedAt: 0,
    }
  );
}

export function getHotStartManifest(): CatalogHotStartManifest | null {
  const raw = cache.get(HOT_START_KEY);
  if (hotStartCache && hotStartCache.raw === raw) {
    return hotStartCache.value;
  }

  const value = normalizeHotStartManifest(
    parseJson<CatalogHotStartManifest>(raw),
  );
  hotStartCache = { raw, value };
  return value;
}

export function setHotStartManifest(manifest: CatalogHotStartManifest): void {
  const raw = JSON.stringify(manifest);
  hotStartCache = { raw, value: manifest };
  cache.set(HOT_START_KEY, raw);
}

export function getCatalogVersion(): number {
  const raw = cache.get(VERSION_KEY);
  return raw ? Number(raw) || 0 : 0;
}

export function setCatalogVersion(version: number): void {
  cache.set(VERSION_KEY, String(version));
}

export function bumpCatalogVersion(): number {
  const version = Date.now();
  setCatalogVersion(version);
  return version;
}

export function subscribeCatalogVersion(
  callback: (version: number) => void,
): () => void {
  return cache.subscribe((key, data) => {
    if (key === VERSION_KEY) {
      callback(data ? Number(data) || 0 : 0);
    }
  });
}

export function getCatalogSyncStatus(): CatalogSyncStatus {
  const raw = cache.get(SYNC_STATUS_KEY);
  if (syncStatusCache && syncStatusCache.raw === raw && syncStatusCache.value) {
    return syncStatusCache.value;
  }

  const value = normalizeCatalogSyncStatus(parseJson<CatalogSyncStatus>(raw));

  syncStatusCache = { raw, value };
  return value;
}

export function setCatalogSyncStatus(status: CatalogSyncStatus): void {
  const raw = JSON.stringify(status);
  syncStatusCache = { raw, value: status };
  cache.set(SYNC_STATUS_KEY, raw);
}

export function subscribeCatalogSyncStatus(
  callback: (status: CatalogSyncStatus) => void,
): () => void {
  return cache.subscribe((key, data) => {
    if (key === SYNC_STATUS_KEY) {
      const value = normalizeCatalogSyncStatus(
        parseJson<CatalogSyncStatus>(data),
      );
      syncStatusCache = { raw: data, value };
      callback(value);
    }
  });
}
