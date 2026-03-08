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

export function getHotStartManifest(): CatalogHotStartManifest | null {
  const raw = cache.get(HOT_START_KEY);
  if (hotStartCache && hotStartCache.raw === raw) {
    return hotStartCache.value;
  }

  const value = parseJson<CatalogHotStartManifest>(raw);
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

  const value = parseJson<CatalogSyncStatus>(raw) ?? {
    status: "idle",
    phase: "idle",
    message: "",
    completedOrganizations: 0,
    totalOrganizations: 0,
    completedScenarios: 0,
    lastSuccessfulSyncAt: getHotStartManifest()?.lastSuccessfulSyncAt ?? null,
    updatedAt: 0,
  };

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
  return cache.subscribe((key) => {
    if (key === SYNC_STATUS_KEY) {
      callback(getCatalogSyncStatus());
    }
  });
}
