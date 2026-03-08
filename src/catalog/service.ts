import { LocalStorage } from "@raycast/api";
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
  fetchCurrentUserId,
  fetchFolders,
  fetchHooks,
  fetchOrganizations,
  fetchScenarioPages,
  fetchTeams,
} from "../api/endpoints.js";
import { Folder, Hook, Organization, Team } from "../api/types.js";
import { createPool } from "../utils/concurrency.js";
import {
  organizationKey,
  scenarioKey,
  teamKey,
} from "../utils/scenario-key.js";
import {
  bumpCatalogVersion,
  getCatalogSyncStatus,
  getHotStartManifest,
  setCatalogSyncStatus,
  setHotStartManifest,
  subscribeCatalogVersion,
} from "./cache.js";
import {
  ACTIVE_DIR,
  CATALOG_DIR,
  CatalogPaths,
  LOCK_PATH,
  WORK_ROOT_DIR,
  catalogHasData,
  clearCatalogManifestCache,
  createWorkCatalogPaths,
  ensureCatalogDirectories,
  getActiveCatalogPaths,
  getCatalogPaths,
  getOrgShardPath,
  getPreferredCatalogRoot,
  migrateLegacyCatalogIfNeeded,
  readActiveManifest,
  readCatalogManifest,
} from "./db.js";
import {
  CatalogDiskManifest,
  CatalogFacets,
  CatalogHotStartManifest,
  CatalogSyncStatus,
  OrganizationListRow,
  OrganizationQueryParams,
  OrganizationScenarioQueryParams,
  PagedResult,
  ScenarioRow,
  ScenarioSearchParams,
} from "./types.js";

export const PAGE_SIZE = 100;

const CATALOG_SCHEMA_VERSION = 2;
const SYNC_TTL_MS = 15 * 60 * 1000;
const LOCK_STALE_MS = 30 * 60 * 1000;
const WAIT_FOR_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const INDEX_ORG_CONCURRENCY = 2;
const INDEX_TEAM_CONCURRENCY = 4;
const ENRICH_ORG_CONCURRENCY = 1;
const ENRICH_TEAM_CONCURRENCY = 3;
const LOAD_ORG_ROWS_CONCURRENCY = 4;
const INITIAL_VISIBLE_FLUSH_BATCH_SIZE = 2;
const INITIAL_VISIBLE_FLUSH_INTERVAL_MS = 1_500;
const ENRICH_VISIBLE_FLUSH_BATCH_SIZE = 2;
const ENRICH_VISIBLE_FLUSH_INTERVAL_MS = 1_500;
const PINNED_STORAGE_KEY = "pinned-scenario-ids";
const RECENT_STORAGE_KEY = "recent-scenario-ids";
const SYNC_STATUS_STALE_MS = 2 * 60 * 1000;

type SyncOrganizationResult = {
  orgRows: ScenarioRow[];
  organizationRows: OrganizationListRow[];
  skipped: boolean;
  skippedName?: string;
  facet: CatalogFacets["organizations"][number] | null;
  teams: CatalogFacets["teamsByOrg"][string];
  needsEnrichment: boolean;
};

interface CatalogBuildState {
  currentUserId: number | null;
  rowsByOrg: Map<string, ScenarioRow[]>;
  organizationRowsByOrg: Map<string, OrganizationListRow[]>;
  organizationFacetsByOrg: Map<string, CatalogFacets["organizations"][number]>;
  teamsByOrg: CatalogFacets["teamsByOrg"];
  skippedOrgs: Set<string>;
  indexedOrgKeys: string[];
  enrichmentPendingOrgKeys: Set<string>;
}

let inProcessSync: Promise<void> | null = null;
let inProcessEnrichment: Promise<void> | null = null;
let releaseLockOnIdle: (() => void) | null = null;

function normalizeSearchQuery(query?: string): string {
  return query?.trim().toLowerCase() ?? "";
}

function compareScenarioRows(
  a: ScenarioRow,
  b: ScenarioRow,
  currentUserId: number | null,
) {
  const aRank = a.updatedByUserId === currentUserId ? 0 : 1;
  const bRank = b.updatedByUserId === currentUserId ? 0 : 1;
  if (aRank !== bRank) {
    return aRank - bRank;
  }

  if (a.lastEditTs !== b.lastEditTs) {
    return b.lastEditTs - a.lastEditTs;
  }

  return a.scenarioName.localeCompare(b.scenarioName);
}

function buildScenarioSearchText(row: ScenarioRow): string {
  return [
    row.scenarioName,
    row.orgName,
    row.teamName,
    row.folderName ?? "",
    row.webhookUrl ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeScenarioRow(row: ScenarioRow): ScenarioRow {
  const normalizedFolderId = row.folderId ?? null;
  const normalizedHookId = row.hookId ?? null;

  return {
    ...row,
    key: scenarioKey(row.zone, row.orgId, row.teamId, row.scenarioId),
    orgKey: organizationKey(row.zone, row.orgId),
    teamKey: teamKey(row.zone, row.teamId),
    folderId: normalizedFolderId,
    hookId: normalizedHookId,
    metadataState:
      row.metadataState ??
      (normalizedFolderId === null && normalizedHookId === null
        ? "ready"
        : row.folderName !== null || row.webhookUrl !== null
          ? "ready"
          : "pending"),
  };
}

function dedupeScenarioRows(rows: ScenarioRow[]): ScenarioRow[] {
  const byKey = new Map<string, ScenarioRow>();

  for (const row of rows) {
    const normalizedRow = normalizeScenarioRow(row);
    const existingRow = byKey.get(normalizedRow.key);

    if (!existingRow) {
      byKey.set(normalizedRow.key, normalizedRow);
      continue;
    }

    if (compareScenarioRows(normalizedRow, existingRow, null) < 0) {
      byKey.set(normalizedRow.key, normalizedRow);
    }
  }

  return [...byKey.values()];
}

function dedupeStringValues(values: string[]): string[] {
  return [...new Set(values)];
}

function getOrganizationLastEditMap(
  rows: ScenarioRow[],
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const row of rows) {
    const currentValue = result[row.orgKey] ?? 0;
    if (row.lastEditTs > currentValue) {
      result[row.orgKey] = row.lastEditTs;
    }
  }

  return result;
}

function sortOrganizationsByPreviousRecency(
  organizations: Organization[],
  previousOrder: Record<string, number>,
) {
  return [...organizations].sort((a, b) => {
    const aKey = organizationKey(a.zone, a.id);
    const bKey = organizationKey(b.zone, b.id);
    const aScore = previousOrder[aKey] ?? 0;
    const bScore = previousOrder[bKey] ?? 0;

    if (aScore !== bScore) {
      return bScore - aScore;
    }

    return a.name.localeCompare(b.name);
  });
}

function matchesScenarioFilters(
  row: ScenarioRow,
  params: ScenarioSearchParams,
  query: string,
  includeKeys: Set<string> | null,
  excludeKeys: Set<string> | null,
): boolean {
  if (includeKeys && !includeKeys.has(row.key)) {
    return false;
  }

  if (excludeKeys?.has(row.key)) {
    return false;
  }

  if (params.status === "active" && row.isPaused) {
    return false;
  }

  if (params.status === "paused" && !row.isPaused) {
    return false;
  }

  if (params.orgKey && row.orgKey !== params.orgKey) {
    return false;
  }

  if (params.teamKey && row.teamKey !== params.teamKey) {
    return false;
  }

  if (query && !buildScenarioSearchText(row).includes(query)) {
    return false;
  }

  return true;
}

function createCatalogBuildState(
  currentUserId: number | null,
): CatalogBuildState {
  return {
    currentUserId,
    rowsByOrg: new Map(),
    organizationRowsByOrg: new Map(),
    organizationFacetsByOrg: new Map(),
    teamsByOrg: {},
    skippedOrgs: new Set(),
    indexedOrgKeys: [],
    enrichmentPendingOrgKeys: new Set(),
  };
}

function getAllRowsFromState(state: CatalogBuildState): ScenarioRow[] {
  return dedupeScenarioRows([...state.rowsByOrg.values()].flat());
}

function buildManifestFromState(
  state: CatalogBuildState,
  lastSuccessfulSyncAt: number | null,
): CatalogDiskManifest {
  const allRows = getAllRowsFromState(state).sort((a, b) =>
    compareScenarioRows(a, b, state.currentUserId),
  );
  const organizationRows = [...state.organizationRowsByOrg.values()]
    .flat()
    .sort(
      (a, b) =>
        a.orgName.localeCompare(b.orgName) ||
        a.teamName.localeCompare(b.teamName),
    );
  const organizations = [...state.organizationFacetsByOrg.values()].sort(
    (a, b) => a.orgName.localeCompare(b.orgName),
  );

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    version: Date.now(),
    lastSuccessfulSyncAt,
    currentUserId: state.currentUserId,
    indexedScenarioCount: allRows.length,
    indexedOrgKeys: [...state.indexedOrgKeys],
    enrichmentPendingOrgKeys: [...state.enrichmentPendingOrgKeys],
    organizationLastEditTs: getOrganizationLastEditMap(allRows),
    defaultScenarioRows: allRows.slice(0, PAGE_SIZE),
    organizationRows,
    facets: {
      organizations,
      teamsByOrg: { ...state.teamsByOrg },
    },
    skippedOrgs: [...state.skippedOrgs].sort((a, b) => a.localeCompare(b)),
  };
}

function addIndexedOrgKey(state: CatalogBuildState, orgKey: string) {
  if (!state.indexedOrgKeys.includes(orgKey)) {
    state.indexedOrgKeys.push(orgKey);
  }
}

function applySyncResultToState(
  state: CatalogBuildState,
  result: SyncOrganizationResult,
) {
  if (!result.facet) {
    return;
  }

  const orgKey = result.facet.orgKey;
  state.rowsByOrg.set(orgKey, dedupeScenarioRows(result.orgRows));
  state.organizationRowsByOrg.set(orgKey, result.organizationRows);
  state.organizationFacetsByOrg.set(orgKey, result.facet);
  state.teamsByOrg[orgKey] = result.teams;
  addIndexedOrgKey(state, orgKey);

  if (result.skipped && result.skippedName) {
    state.skippedOrgs.add(result.skippedName);
    state.enrichmentPendingOrgKeys.delete(orgKey);
  } else if (result.needsEnrichment) {
    state.enrichmentPendingOrgKeys.add(orgKey);
  } else {
    state.enrichmentPendingOrgKeys.delete(orgKey);
  }
}

async function readStoredIds(key: string): Promise<string[]> {
  try {
    const raw = await LocalStorage.getItem<string>(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? dedupeStringValues(
          parsed.filter((value): value is string => typeof value === "string"),
        )
      : [];
  } catch {
    return [];
  }
}

async function readJsonlRows(filePath: string): Promise<ScenarioRow[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  const rows: ScenarioRow[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line) continue;
      rows.push(normalizeScenarioRow(JSON.parse(line) as ScenarioRow));
    }
  } finally {
    rl.close();
  }

  return dedupeScenarioRows(rows);
}

async function collectPagedScenarioRows(
  filePath: string,
  params: ScenarioSearchParams,
): Promise<PagedResult<ScenarioRow>> {
  if (!existsSync(filePath)) {
    return { rows: [], hasMore: false, totalCount: 0 };
  }

  const query = normalizeSearchQuery(params.query);
  const includeKeys = params.includeKeys ? new Set(params.includeKeys) : null;
  const excludeKeys = params.excludeKeys ? new Set(params.excludeKeys) : null;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? PAGE_SIZE;
  const rows: ScenarioRow[] = [];
  const seenKeys = new Set<string>();
  let matched = 0;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  try {
    for await (const line of rl) {
      if (!line) continue;
      const row = normalizeScenarioRow(JSON.parse(line) as ScenarioRow);
      if (seenKeys.has(row.key)) {
        continue;
      }
      seenKeys.add(row.key);

      if (
        !matchesScenarioFilters(row, params, query, includeKeys, excludeKeys)
      ) {
        continue;
      }

      matched += 1;
      if (matched > offset && rows.length < limit) {
        rows.push(row);
      }
    }
  } finally {
    rl.close();
  }

  return {
    rows,
    hasMore: offset + rows.length < matched,
    totalCount: matched,
  };
}

async function loadRowsByOrg(
  rootDir: string,
  orgKeys: string[],
): Promise<Map<string, ScenarioRow[]>> {
  const rowsByOrg = new Map<string, ScenarioRow[]>();
  const readPool = createPool(LOAD_ORG_ROWS_CONCURRENCY);

  await Promise.all(
    orgKeys.map((orgKey) =>
      readPool.run(async () => {
        rowsByOrg.set(
          orgKey,
          await readJsonlRows(getOrgShardPath(rootDir, orgKey)),
        );
      }),
    ),
  );

  return rowsByOrg;
}

async function getScenarioRowsByKeysFromRoot(
  rootDir: string,
  keys: string[],
  params: Omit<
    ScenarioSearchParams,
    "includeKeys" | "excludeKeys" | "limit" | "offset"
  > = {},
): Promise<ScenarioRow[]> {
  const dedupedKeys = dedupeStringValues(keys);
  if (dedupedKeys.length === 0) {
    return [];
  }

  const { globalScenariosPath } = getCatalogPaths(rootDir);
  const { rows } = await collectPagedScenarioRows(globalScenariosPath, {
    ...params,
    includeKeys: dedupedKeys,
    limit: dedupedKeys.length,
    offset: 0,
  });

  const byKey = new Map(rows.map((row) => [row.key, row]));
  return dedupedKeys
    .map((key) => byKey.get(key))
    .filter(Boolean) as ScenarioRow[];
}

async function rebuildHotStartManifest(
  manifest: CatalogDiskManifest,
  rootDir: string,
  isPartial: boolean,
) {
  const [pinnedIds, recentIds] = await Promise.all([
    readStoredIds(PINNED_STORAGE_KEY),
    readStoredIds(RECENT_STORAGE_KEY),
  ]);

  const pinnedRows = await getScenarioRowsByKeysFromRoot(rootDir, pinnedIds);
  const recentRows = await getScenarioRowsByKeysFromRoot(
    rootDir,
    recentIds.filter((id) => !pinnedIds.includes(id)),
  );

  const hotStart: CatalogHotStartManifest = {
    version: manifest.version,
    lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
    isPartial,
    indexedScenarioCount: manifest.indexedScenarioCount,
    defaultScenarioRows: dedupeScenarioRows(manifest.defaultScenarioRows),
    pinnedRows: dedupeScenarioRows(pinnedRows),
    recentRows: dedupeScenarioRows(recentRows),
    organizationRows: manifest.organizationRows,
    facets: manifest.facets,
    skippedOrgs: manifest.skippedOrgs,
  };

  setHotStartManifest(hotStart);
}

function publishSyncStatus(
  status: Omit<CatalogSyncStatus, "updatedAt">,
  bumpVersionFlag = false,
) {
  if (status.status === "running") {
    try {
      writeFileSync(
        LOCK_PATH,
        JSON.stringify({ pid: process.pid, at: Date.now() }),
      );
    } catch {
      // Ignore heartbeat refresh failures; the next sync can recover.
    }
  }

  setCatalogSyncStatus({
    ...status,
    updatedAt: Date.now(),
  });

  if (bumpVersionFlag) {
    bumpCatalogVersion();
  }
}

function isProcessAlive(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ESRCH"
    );
  }
}

function getSyncLockPid(): number | undefined {
  try {
    const raw = readFileSync(LOCK_PATH, "utf8");
    const parsed = JSON.parse(raw) as { pid?: unknown };
    return typeof parsed.pid === "number" ? parsed.pid : undefined;
  } catch {
    return undefined;
  }
}

function hasFreshSyncLock(): boolean {
  if (!existsSync(LOCK_PATH)) {
    return false;
  }

  try {
    const stats = statSync(LOCK_PATH);
    if (Date.now() - stats.mtimeMs > SYNC_STATUS_STALE_MS) {
      return false;
    }

    const lockPid = getSyncLockPid();
    return lockPid === process.pid || isProcessAlive(lockPid);
  } catch {
    return false;
  }
}

function clearSyncLock() {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // Ignore stale lock cleanup failures.
  }
}

function tryAcquireSyncLock(): (() => void) | null {
  ensureCatalogDirectories();

  try {
    writeFileSync(
      LOCK_PATH,
      JSON.stringify({ pid: process.pid, at: Date.now() }),
      { flag: "wx" },
    );
    return () => {
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        // Ignore lock cleanup failures.
      }
    };
  } catch (error) {
    const existsError =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "EEXIST";

    if (!existsError) {
      throw error;
    }

    try {
      const stats = statSync(LOCK_PATH);
      if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
        unlinkSync(LOCK_PATH);
        return tryAcquireSyncLock();
      }

      if (!isProcessAlive(getSyncLockPid())) {
        unlinkSync(LOCK_PATH);
        return tryAcquireSyncLock();
      }
    } catch {
      return tryAcquireSyncLock();
    }

    return null;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForActiveSync() {
  const deadline = Date.now() + WAIT_FOR_SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (getCatalogSyncStatus().status !== "running") {
      return;
    }
    await delay(500);
  }
}

async function writeTextAtomic(filePath: string, body: string) {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, body, "utf8");
  await rename(tempPath, filePath);
}

async function writeJsonlAtomic(filePath: string, rows: ScenarioRow[]) {
  const body = dedupeScenarioRows(rows)
    .map((row) => JSON.stringify(row))
    .join("\n");

  await writeTextAtomic(filePath, body.length > 0 ? `${body}\n` : "");
}

async function writeCatalogSnapshot(
  paths: CatalogPaths,
  manifest: CatalogDiskManifest,
  rowsByOrg: Map<string, ScenarioRow[]>,
  options: {
    changedOrgKey?: string;
    includeGlobalSnapshot?: boolean;
  } = {},
) {
  const { changedOrgKey, includeGlobalSnapshot = true } = options;
  const sortRows = (rows: ScenarioRow[]) =>
    dedupeScenarioRows(rows).sort((a, b) =>
      compareScenarioRows(a, b, manifest.currentUserId),
    );

  await mkdir(paths.rootDir, { recursive: true });
  await mkdir(paths.orgsDir, { recursive: true });

  if (changedOrgKey) {
    await writeJsonlAtomic(
      getOrgShardPath(paths.rootDir, changedOrgKey),
      sortRows(rowsByOrg.get(changedOrgKey) ?? []),
    );
  } else {
    for (const [orgKey, rows] of rowsByOrg) {
      await writeJsonlAtomic(
        getOrgShardPath(paths.rootDir, orgKey),
        sortRows(rows),
      );
    }
  }

  if (!includeGlobalSnapshot) {
    return;
  }

  await writeJsonlAtomic(
    paths.globalScenariosPath,
    sortRows([...rowsByOrg.values()].flat()),
  );
  await writeTextAtomic(paths.manifestPath, JSON.stringify(manifest));
  clearCatalogManifestCache(paths.rootDir);
}

async function removeOtherWorkCatalogs(exceptRootDir?: string) {
  if (!existsSync(WORK_ROOT_DIR)) {
    return;
  }

  const entries = await readdir(WORK_ROOT_DIR, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(WORK_ROOT_DIR, entry.name))
      .filter((rootDir) => rootDir !== exceptRootDir)
      .map((rootDir) => rm(rootDir, { recursive: true, force: true })),
  );
}

async function promoteWorkCatalog(
  workPaths: CatalogPaths,
  manifest: CatalogDiskManifest,
  state: CatalogBuildState,
) {
  await writeCatalogSnapshot(workPaths, manifest, state.rowsByOrg);

  const backupDir = join(CATALOG_DIR, `active.backup-${Date.now()}`);
  const activePaths = getActiveCatalogPaths();

  if (existsSync(activePaths.rootDir)) {
    await rename(activePaths.rootDir, backupDir);
  }

  await rename(workPaths.rootDir, ACTIVE_DIR);
  await rm(backupDir, { recursive: true, force: true });
  await removeOtherWorkCatalogs();
  clearCatalogManifestCache();
}

function getPreviousOrganizationRows(
  orgKeyValue: string,
): OrganizationListRow[] {
  return (readActiveManifest()?.organizationRows ?? []).filter(
    (row) => row.orgKey === orgKeyValue,
  );
}

function getPreviousFacetTeams(orgKeyValue: string) {
  return readActiveManifest()?.facets.teamsByOrg[orgKeyValue] ?? [];
}

function getPreviousFacetOrg(orgKeyValue: string) {
  return (readActiveManifest()?.facets.organizations ?? []).find(
    (org) => org.orgKey === orgKeyValue,
  );
}

async function readPreviousOrgRows(
  orgKeyValue: string,
): Promise<ScenarioRow[]> {
  return readJsonlRows(getOrgShardPath(ACTIVE_DIR, orgKeyValue));
}

async function buildTeamRowsFastIndex(
  org: Organization,
  team: Team,
  onProgress?: (event: { teamName: string; scenarioCount: number }) => void,
): Promise<ScenarioRow[]> {
  const rows: ScenarioRow[] = [];
  let scenarioCount = 0;

  for await (const scenarios of fetchScenarioPages(org.zone, team.id)) {
    scenarioCount += scenarios.length;
    onProgress?.({ teamName: team.name, scenarioCount });

    for (const scenario of scenarios) {
      rows.push({
        key: scenarioKey(org.zone, org.id, team.id, scenario.id),
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        orgKey: organizationKey(org.zone, org.id),
        orgId: org.id,
        orgName: org.name,
        zone: org.zone,
        teamKey: teamKey(org.zone, team.id),
        teamId: team.id,
        teamName: team.name,
        folderId: scenario.folderId,
        folderName: null,
        hookId: scenario.hookId,
        webhookUrl: null,
        metadataState: "pending",
        isPaused: scenario.isPaused,
        lastEditTs: Date.parse(scenario.lastEdit) || 0,
        updatedByUserId: scenario.updatedByUser?.id ?? null,
      });
    }
  }

  return dedupeScenarioRows(rows);
}

async function syncOrganizationFastIndex(
  org: Organization,
  onProgress?: (event: {
    orgName: string;
    teamName: string;
    scenarioCount: number;
  }) => void,
): Promise<SyncOrganizationResult> {
  const orgKeyValue = organizationKey(org.zone, org.id);

  try {
    const teams = await fetchTeams(org.zone, org.id);
    const organizationRows: OrganizationListRow[] = teams.map((team) => ({
      orgKey: orgKeyValue,
      orgId: org.id,
      orgName: org.name,
      zone: org.zone,
      teamKey: teamKey(org.zone, team.id),
      teamId: team.id,
      teamName: team.name,
    }));

    const teamPool = createPool(INDEX_TEAM_CONCURRENCY);
    const teamRows = new Array<ScenarioRow[]>(teams.length);

    await Promise.all(
      teams.map((team, index) =>
        teamPool.run(async () => {
          const rows = await buildTeamRowsFastIndex(org, team, (event) => {
            onProgress?.({
              orgName: org.name,
              teamName: event.teamName,
              scenarioCount: event.scenarioCount,
            });
          });
          teamRows[index] = rows;
        }),
      ),
    );

    return {
      orgRows: dedupeScenarioRows(teamRows.flat()),
      organizationRows,
      skipped: false,
      facet: {
        orgKey: orgKeyValue,
        orgId: org.id,
        orgName: org.name,
        zone: org.zone,
      },
      teams: organizationRows.map((row) => ({
        teamKey: row.teamKey,
        teamId: row.teamId,
        teamName: row.teamName,
      })),
      needsEnrichment: true,
    };
  } catch {
    const fallbackRows = await readPreviousOrgRows(orgKeyValue);
    const previousFacet = getPreviousFacetOrg(orgKeyValue);

    return {
      orgRows: fallbackRows,
      organizationRows: getPreviousOrganizationRows(orgKeyValue),
      skipped: true,
      skippedName: org.name,
      facet: previousFacet ?? {
        orgKey: orgKeyValue,
        orgId: org.id,
        orgName: org.name,
        zone: org.zone,
      },
      teams: getPreviousFacetTeams(orgKeyValue),
      needsEnrichment: false,
    };
  }
}

function applyTeamMetadata(
  rows: ScenarioRow[],
  teamId: number,
  folders: Folder[],
  hooks: Hook[],
): ScenarioRow[] {
  const folderNames = new Map(
    folders.map((folder) => [folder.id, folder.name]),
  );
  const hookUrls = new Map(
    hooks.filter((hook) => hook.url).map((hook) => [hook.id, hook.url]),
  );

  return rows.map((row) => {
    if (row.teamId !== teamId) {
      return row;
    }

    return {
      ...row,
      folderName: row.folderId ? (folderNames.get(row.folderId) ?? null) : null,
      webhookUrl: row.hookId ? (hookUrls.get(row.hookId) ?? null) : null,
      metadataState: "ready",
    };
  });
}

async function enrichOrganizationRows(
  orgKeyValue: string,
  state: CatalogBuildState,
  onProgress?: (event: { orgName: string; teamName: string }) => void,
) {
  const facet = state.organizationFacetsByOrg.get(orgKeyValue);
  if (!facet) {
    state.enrichmentPendingOrgKeys.delete(orgKeyValue);
    return;
  }

  const teams = state.teamsByOrg[orgKeyValue] ?? [];
  const rowsByTeam = new Map<number, ScenarioRow[]>();

  for (const row of state.rowsByOrg.get(orgKeyValue) ?? []) {
    const teamRows = rowsByTeam.get(row.teamId) ?? [];
    teamRows.push(row);
    rowsByTeam.set(row.teamId, teamRows);
  }

  const teamPool = createPool(ENRICH_TEAM_CONCURRENCY);

  await Promise.all(
    teams.map((team) =>
      teamPool.run(async () => {
        const teamRows = rowsByTeam.get(team.teamId) ?? [];
        if (teamRows.length === 0) {
          return;
        }

        onProgress?.({ orgName: facet.orgName, teamName: team.teamName });
        const [folders, hooks] = await Promise.all([
          fetchFolders(facet.zone, team.teamId),
          fetchHooks(facet.zone, team.teamId),
        ]);

        rowsByTeam.set(
          team.teamId,
          applyTeamMetadata(teamRows, team.teamId, folders, hooks),
        );
      }),
    ),
  );

  const nextRows = dedupeScenarioRows([...rowsByTeam.values()].flat());

  state.rowsByOrg.set(orgKeyValue, dedupeScenarioRows(nextRows));
  if (nextRows.every((row) => row.metadataState === "ready")) {
    state.enrichmentPendingOrgKeys.delete(orgKeyValue);
  }
}

async function performMetadataEnrichment(
  state: CatalogBuildState,
  lastSuccessfulSyncAt: number,
  totalOrganizations: number,
  completedScenarios: number,
) {
  const activePaths = getActiveCatalogPaths();
  const orgPool = createPool(ENRICH_ORG_CONCURRENCY);
  const orgKeys = [...state.enrichmentPendingOrgKeys];
  let pendingVisibleFlushCount = 0;
  let lastVisibleFlushAt = 0;

  await Promise.all(
    orgKeys.map((orgKeyValue) =>
      orgPool.run(async () => {
        const facet = state.organizationFacetsByOrg.get(orgKeyValue);
        if (!facet) {
          state.enrichmentPendingOrgKeys.delete(orgKeyValue);
          return;
        }

        publishSyncStatus({
          status: "running",
          phase: "enriching",
          message: `Enriching ${facet.orgName}`,
          completedOrganizations: totalOrganizations,
          totalOrganizations,
          completedScenarios,
          lastSuccessfulSyncAt,
        });

        await enrichOrganizationRows(orgKeyValue, state, (event) => {
          publishSyncStatus({
            status: "running",
            phase: "enriching",
            message: `Enriching ${event.orgName} / ${event.teamName}`,
            completedOrganizations: totalOrganizations,
            totalOrganizations,
            completedScenarios,
            lastSuccessfulSyncAt,
          });
        });

        const manifest = buildManifestFromState(state, lastSuccessfulSyncAt);
        pendingVisibleFlushCount += 1;

        const shouldFlushVisibleSnapshot =
          manifest.enrichmentPendingOrgKeys.length === 0 ||
          pendingVisibleFlushCount >= ENRICH_VISIBLE_FLUSH_BATCH_SIZE ||
          Date.now() - lastVisibleFlushAt >= ENRICH_VISIBLE_FLUSH_INTERVAL_MS;

        await writeCatalogSnapshot(activePaths, manifest, state.rowsByOrg, {
          changedOrgKey: shouldFlushVisibleSnapshot ? undefined : orgKeyValue,
          includeGlobalSnapshot: shouldFlushVisibleSnapshot,
        });

        if (shouldFlushVisibleSnapshot) {
          await rebuildHotStartManifest(
            manifest,
            ACTIVE_DIR,
            manifest.enrichmentPendingOrgKeys.length > 0,
          );
          pendingVisibleFlushCount = 0;
          lastVisibleFlushAt = Date.now();
          bumpCatalogVersion();
        }
      }),
    ),
  );

  publishSyncStatus({
    status: "idle",
    phase: "idle",
    message: "",
    completedOrganizations: totalOrganizations,
    totalOrganizations,
    completedScenarios,
    lastSuccessfulSyncAt,
  });
}

async function startBackgroundEnrichment(
  state: CatalogBuildState,
  manifest: CatalogDiskManifest,
  completedScenarios: number,
) {
  if (manifest.enrichmentPendingOrgKeys.length === 0) {
    publishSyncStatus({
      status: "idle",
      phase: "idle",
      message: "",
      completedOrganizations: manifest.indexedOrgKeys.length,
      totalOrganizations: manifest.indexedOrgKeys.length,
      completedScenarios,
      lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
    });

    if (releaseLockOnIdle) {
      releaseLockOnIdle();
      releaseLockOnIdle = null;
    }
    return;
  }

  inProcessEnrichment = performMetadataEnrichment(
    state,
    manifest.lastSuccessfulSyncAt ?? Date.now(),
    manifest.indexedOrgKeys.length,
    completedScenarios,
  )
    .catch((error) => {
      publishSyncStatus({
        status: "error",
        phase: "idle",
        message: "Catalog enrichment failed",
        completedOrganizations: manifest.indexedOrgKeys.length,
        totalOrganizations: manifest.indexedOrgKeys.length,
        completedScenarios,
        lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      if (releaseLockOnIdle) {
        releaseLockOnIdle();
        releaseLockOnIdle = null;
      }
      inProcessEnrichment = null;
    });
}

async function loadBuildStateFromManifest(
  rootDir: string,
  manifest: CatalogDiskManifest,
): Promise<CatalogBuildState> {
  const state = createCatalogBuildState(manifest.currentUserId);
  state.indexedOrgKeys = [...manifest.indexedOrgKeys];
  state.enrichmentPendingOrgKeys = new Set(manifest.enrichmentPendingOrgKeys);
  state.skippedOrgs = new Set(manifest.skippedOrgs);
  state.organizationFacetsByOrg = new Map(
    manifest.facets.organizations.map((org) => [org.orgKey, org]),
  );
  state.teamsByOrg = { ...manifest.facets.teamsByOrg };

  for (const orgKeyValue of manifest.indexedOrgKeys) {
    state.organizationRowsByOrg.set(
      orgKeyValue,
      manifest.organizationRows.filter((row) => row.orgKey === orgKeyValue),
    );
  }

  state.rowsByOrg = await loadRowsByOrg(rootDir, manifest.indexedOrgKeys);
  return state;
}

async function performCatalogSync() {
  migrateLegacyCatalogIfNeeded();
  ensureCatalogDirectories();
  await removeOtherWorkCatalogs();

  publishSyncStatus({
    status: "running",
    phase: "discovering",
    message: "Discovering organizations",
    completedOrganizations: 0,
    totalOrganizations: 0,
    completedScenarios: 0,
    lastSuccessfulSyncAt: readActiveManifest()?.lastSuccessfulSyncAt ?? null,
  });

  const previousManifest = readActiveManifest();
  const [currentUserId, discoveredOrganizations] = await Promise.all([
    fetchCurrentUserId(),
    fetchOrganizations({ bypassCache: true }),
  ]);
  const organizations = sortOrganizationsByPreviousRecency(
    discoveredOrganizations,
    previousManifest?.organizationLastEditTs ?? {},
  );

  const state = createCatalogBuildState(currentUserId);
  const workPaths = createWorkCatalogPaths(String(Date.now()));
  const hasActiveCatalog = catalogHasData(ACTIVE_DIR);
  let completedOrganizations = 0;
  let completedScenarios = 0;
  const orgPool = createPool(INDEX_ORG_CONCURRENCY);
  const partialWritePool = createPool(1);
  let pendingVisibleFlushCount = 0;
  let lastVisibleFlushAt = 0;

  await Promise.all(
    organizations.map((org) =>
      orgPool.run(async () => {
        publishSyncStatus({
          status: "running",
          phase: "indexing",
          message: `Indexing ${org.name}`,
          completedOrganizations,
          totalOrganizations: organizations.length,
          completedScenarios,
          lastSuccessfulSyncAt: previousManifest?.lastSuccessfulSyncAt ?? null,
        });

        const result = await syncOrganizationFastIndex(org, (event) => {
          publishSyncStatus({
            status: "running",
            phase: "indexing",
            message: `Indexing ${event.orgName} / ${event.teamName}`,
            completedOrganizations,
            totalOrganizations: organizations.length,
            completedScenarios: completedScenarios + event.scenarioCount,
            lastSuccessfulSyncAt:
              previousManifest?.lastSuccessfulSyncAt ?? null,
          });
        });

        applySyncResultToState(state, result);
        completedOrganizations += 1;
        completedScenarios += result.orgRows.length;

        if (!hasActiveCatalog) {
          const forceVisibleFlush = completedOrganizations === 1;

          await partialWritePool.run(async () => {
            pendingVisibleFlushCount += 1;

            const partialManifest = buildManifestFromState(
              state,
              previousManifest?.lastSuccessfulSyncAt ?? null,
            );
            const shouldFlushVisibleSnapshot =
              forceVisibleFlush ||
              pendingVisibleFlushCount >= INITIAL_VISIBLE_FLUSH_BATCH_SIZE ||
              Date.now() - lastVisibleFlushAt >=
                INITIAL_VISIBLE_FLUSH_INTERVAL_MS;

            await writeCatalogSnapshot(
              workPaths,
              partialManifest,
              state.rowsByOrg,
              {
                changedOrgKey: shouldFlushVisibleSnapshot
                  ? undefined
                  : result.facet?.orgKey,
                includeGlobalSnapshot: shouldFlushVisibleSnapshot,
              },
            );

            if (shouldFlushVisibleSnapshot) {
              await rebuildHotStartManifest(
                partialManifest,
                workPaths.rootDir,
                true,
              );
              pendingVisibleFlushCount = 0;
              lastVisibleFlushAt = Date.now();
              bumpCatalogVersion();
            }
          });
        }

        publishSyncStatus({
          status: "running",
          phase: "indexing",
          message: `Indexed ${completedOrganizations} of ${organizations.length} organizations`,
          completedOrganizations,
          totalOrganizations: organizations.length,
          completedScenarios,
          lastSuccessfulSyncAt: previousManifest?.lastSuccessfulSyncAt ?? null,
        });
      }),
    ),
  );

  const promotedManifest = buildManifestFromState(state, Date.now());

  publishSyncStatus({
    status: "running",
    phase: "finalizing",
    message: "Promoting indexed catalog",
    completedOrganizations,
    totalOrganizations: organizations.length,
    completedScenarios,
    lastSuccessfulSyncAt: promotedManifest.lastSuccessfulSyncAt,
  });

  await promoteWorkCatalog(workPaths, promotedManifest, state);
  await rebuildHotStartManifest(
    promotedManifest,
    ACTIVE_DIR,
    promotedManifest.enrichmentPendingOrgKeys.length > 0,
  );
  bumpCatalogVersion();

  publishSyncStatus({
    status: "running",
    phase: "enriching",
    message: "Enriching scenario metadata",
    completedOrganizations,
    totalOrganizations: organizations.length,
    completedScenarios,
    lastSuccessfulSyncAt: promotedManifest.lastSuccessfulSyncAt,
  });

  void startBackgroundEnrichment(state, promotedManifest, completedScenarios);
}

async function updateScenarioRowsInCatalog(
  rootDir: string,
  orgKeyValue: string,
  updater: (rows: ScenarioRow[]) => ScenarioRow[],
) {
  const manifest = readCatalogManifest(rootDir);
  if (!manifest) {
    return;
  }

  const state = await loadBuildStateFromManifest(rootDir, manifest);
  state.rowsByOrg.set(
    orgKeyValue,
    dedupeScenarioRows(updater(state.rowsByOrg.get(orgKeyValue) ?? [])),
  );
  const nextManifest = buildManifestFromState(
    state,
    manifest.lastSuccessfulSyncAt,
  );
  await writeCatalogSnapshot(
    getCatalogPaths(rootDir),
    nextManifest,
    state.rowsByOrg,
    { changedOrgKey: orgKeyValue },
  );
  await rebuildHotStartManifest(
    nextManifest,
    rootDir,
    nextManifest.enrichmentPendingOrgKeys.length > 0,
  );
  bumpCatalogVersion();
}

async function verifyCatalogBootstrapState(): Promise<void> {
  migrateLegacyCatalogIfNeeded();

  const preferredRoot = getPreferredCatalogRoot();
  const manifest = preferredRoot ? readCatalogManifest(preferredRoot) : null;
  if (preferredRoot && manifest && !getHotStartManifest()) {
    await rebuildHotStartManifest(
      manifest,
      preferredRoot,
      preferredRoot !== ACTIVE_DIR ||
        manifest.enrichmentPendingOrgKeys.length > 0,
    );
    bumpCatalogVersion();
  }

  const syncStatus = getCatalogSyncStatus();
  const shouldRecoverStaleSync =
    syncStatus.status === "running" &&
    !inProcessSync &&
    !inProcessEnrichment &&
    (!hasFreshSyncLock() ||
      Date.now() - syncStatus.updatedAt > SYNC_STATUS_STALE_MS);

  if (shouldRecoverStaleSync) {
    clearSyncLock();
    publishSyncStatus({
      status: "idle",
      phase: "idle",
      message: "",
      completedOrganizations: 0,
      totalOrganizations: 0,
      completedScenarios: 0,
      lastSuccessfulSyncAt: manifest?.lastSuccessfulSyncAt ?? null,
    });
  }
}

export async function searchScenarios(
  params: ScenarioSearchParams = {},
): Promise<PagedResult<ScenarioRow>> {
  const rootDir = getPreferredCatalogRoot();
  if (!rootDir) {
    return { rows: [], hasMore: false, totalCount: 0 };
  }

  const filePath = params.orgKey
    ? getOrgShardPath(rootDir, params.orgKey)
    : getCatalogPaths(rootDir).globalScenariosPath;
  return collectPagedScenarioRows(filePath, params);
}

export async function listOrgScenarios(
  params: OrganizationScenarioQueryParams,
): Promise<PagedResult<ScenarioRow>> {
  const rootDir = getPreferredCatalogRoot();
  if (!rootDir) {
    return { rows: [], hasMore: false, totalCount: 0 };
  }

  return collectPagedScenarioRows(
    getOrgShardPath(rootDir, params.orgKey),
    params,
  );
}

export async function getScenarioRowsByKeys(
  keys: string[],
  params: Omit<
    ScenarioSearchParams,
    "includeKeys" | "excludeKeys" | "limit" | "offset"
  > = {},
): Promise<ScenarioRow[]> {
  const rootDir = getPreferredCatalogRoot();
  if (!rootDir) {
    return [];
  }

  return getScenarioRowsByKeysFromRoot(rootDir, keys, params);
}

export async function listOrganizations(
  params: OrganizationQueryParams = {},
): Promise<PagedResult<OrganizationListRow>> {
  const rootDir = getPreferredCatalogRoot();
  const manifest =
    (rootDir ? readCatalogManifest(rootDir) : null) ?? getHotStartManifest();
  const rows = manifest?.organizationRows ?? [];
  const query = normalizeSearchQuery(params.query);
  const filtered = query
    ? rows.filter(
        (row) =>
          row.orgName.toLowerCase().includes(query) ||
          row.teamName.toLowerCase().includes(query),
      )
    : rows;
  const offset = params.offset ?? 0;
  const limit = params.limit ?? PAGE_SIZE;
  const page = filtered.slice(offset, offset + limit);

  return {
    rows: page,
    hasMore: offset + limit < filtered.length,
    totalCount: filtered.length,
  };
}

export function getFacets(): CatalogFacets {
  const rootDir = getPreferredCatalogRoot();
  return (
    (rootDir ? readCatalogManifest(rootDir)?.facets : null) ??
    getHotStartManifest()?.facets ?? {
      organizations: [],
      teamsByOrg: {},
    }
  );
}

export function getSkippedOrganizations(): string[] {
  const rootDir = getPreferredCatalogRoot();
  return (
    (rootDir ? readCatalogManifest(rootDir)?.skippedOrgs : null) ??
    getHotStartManifest()?.skippedOrgs ??
    []
  );
}

export function hasCatalogData(): boolean {
  const preferredRoot = getPreferredCatalogRoot();
  return preferredRoot ? catalogHasData(preferredRoot) : false;
}

export async function resolveScenarioWebhookUrl(
  item: ScenarioRow,
): Promise<string | null> {
  if (item.webhookUrl) {
    return item.webhookUrl;
  }

  if (!item.hookId) {
    return null;
  }

  const hooks = await fetchHooks(item.zone, item.teamId);
  const webhookUrl = hooks.find((hook) => hook.id === item.hookId)?.url ?? null;

  const rootDir = getPreferredCatalogRoot();
  if (rootDir && webhookUrl) {
    await updateScenarioRowsInCatalog(rootDir, item.orgKey, (rows) =>
      rows.map((row) => (row.key === item.key ? { ...row, webhookUrl } : row)),
    );
  }

  return webhookUrl;
}

export async function syncCatalog({
  force = false,
}: {
  force?: boolean;
} = {}): Promise<void> {
  const activeManifest = readActiveManifest();

  if (
    !force &&
    activeManifest?.lastSuccessfulSyncAt &&
    activeManifest.enrichmentPendingOrgKeys.length === 0 &&
    Date.now() - activeManifest.lastSuccessfulSyncAt < SYNC_TTL_MS
  ) {
    return;
  }

  if (inProcessSync) {
    return inProcessSync;
  }

  if (inProcessEnrichment) {
    return;
  }

  const releaseLock = tryAcquireSyncLock();
  if (!releaseLock) {
    if (!hasCatalogData()) {
      await waitForActiveSync();
    }
    return;
  }

  releaseLockOnIdle = releaseLock;
  inProcessSync = performCatalogSync()
    .catch((error) => {
      publishSyncStatus({
        status: "error",
        phase: "idle",
        message: "Catalog sync failed",
        completedOrganizations: 0,
        totalOrganizations: 0,
        completedScenarios: 0,
        lastSuccessfulSyncAt:
          readActiveManifest()?.lastSuccessfulSyncAt ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      inProcessSync = null;
      if (!inProcessEnrichment && releaseLockOnIdle) {
        releaseLockOnIdle();
        releaseLockOnIdle = null;
      }
    });

  return inProcessSync;
}

export async function ensureCatalogReady(): Promise<void> {
  await verifyCatalogBootstrapState();

  const activeManifest = readActiveManifest();
  const hasSnapshot = hasCatalogData() || getHotStartManifest() !== null;

  if (!hasSnapshot) {
    await syncCatalog({ force: true });
    return;
  }

  if (
    activeManifest &&
    activeManifest.enrichmentPendingOrgKeys.length > 0 &&
    !inProcessSync &&
    !inProcessEnrichment
  ) {
    const state = await loadBuildStateFromManifest(ACTIVE_DIR, activeManifest);
    void startBackgroundEnrichment(
      state,
      activeManifest,
      activeManifest.indexedScenarioCount,
    );
  }

  void syncCatalog();
}

export { subscribeCatalogVersion };
