import { LocalStorage } from "@raycast/api";
import {
  createReadStream,
  existsSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
  CATALOG_DIR,
  GLOBAL_SCENARIOS_PATH,
  LOCK_PATH,
  MANIFEST_PATH,
  ORGS_DIR,
  clearDiskManifestCache,
  ensureCatalogDirectories,
  getOrgShardPath,
  readDiskManifest,
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

const SYNC_TTL_MS = 15 * 60 * 1000;
const LOCK_STALE_MS = 30 * 60 * 1000;
const WAIT_FOR_SYNC_TIMEOUT_MS = 5 * 60 * 1000;
const PINNED_STORAGE_KEY = "pinned-scenario-ids";
const RECENT_STORAGE_KEY = "recent-scenario-ids";

let inProcessSync: Promise<void> | null = null;

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
  const normalizedOrgKey = organizationKey(row.zone, row.orgId);
  const normalizedTeamKey = teamKey(row.zone, row.teamId);

  return {
    ...row,
    key: scenarioKey(row.zone, row.orgId, row.teamId, row.scenarioId),
    orgKey: normalizedOrgKey,
    teamKey: normalizedTeamKey,
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

function sortOrganizationsByPreviousRecency(organizations: Organization[]) {
  const previousOrder = readDiskManifest()?.organizationLastEditTs ?? {};

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

function getScenarioFilePath(params: ScenarioSearchParams): string {
  if (params.orgKey) {
    return getOrgShardPath(params.orgKey);
  }
  return GLOBAL_SCENARIOS_PATH;
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

      if (matched >= offset && rows.length < limit) {
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

async function readPreviousOrgRows(
  orgKeyValue: string,
): Promise<ScenarioRow[]> {
  return readJsonlRows(getOrgShardPath(orgKeyValue));
}

function getPreviousOrganizationRows(
  orgKeyValue: string,
): OrganizationListRow[] {
  return (readDiskManifest()?.organizationRows ?? []).filter(
    (row) => row.orgKey === orgKeyValue,
  );
}

function getPreviousFacetTeams(orgKeyValue: string) {
  return readDiskManifest()?.facets.teamsByOrg[orgKeyValue] ?? [];
}

function getPreviousFacetOrg(orgKeyValue: string) {
  return (readDiskManifest()?.facets.organizations ?? []).find(
    (org) => org.orgKey === orgKeyValue,
  );
}

async function rebuildHotStartManifest(manifest: CatalogDiskManifest) {
  const [pinnedIds, recentIds] = await Promise.all([
    readStoredIds(PINNED_STORAGE_KEY),
    readStoredIds(RECENT_STORAGE_KEY),
  ]);

  const pinnedRows = await getScenarioRowsByKeys(pinnedIds);
  const recentRows = await getScenarioRowsByKeys(
    recentIds.filter((id) => !pinnedIds.includes(id)),
  );

  const hotStart: CatalogHotStartManifest = {
    version: manifest.version,
    lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
    defaultScenarioRows: dedupeScenarioRows(manifest.defaultScenarioRows),
    pinnedRows: dedupeScenarioRows(pinnedRows),
    recentRows: dedupeScenarioRows(recentRows),
    organizationRows: manifest.organizationRows,
    facets: manifest.facets,
    skippedOrgs: manifest.skippedOrgs,
  };

  setHotStartManifest(hotStart);
}

async function verifyCatalogBootstrapState(): Promise<void> {
  const manifest = readDiskManifest();
  if (!manifest || !hasCatalogData()) {
    return;
  }

  if (!getHotStartManifest()) {
    await rebuildHotStartManifest(manifest);
    bumpCatalogVersion();
  }

  if (
    getCatalogSyncStatus().status === "running" &&
    !inProcessSync &&
    !existsSync(LOCK_PATH)
  ) {
    publishSyncStatus({
      status: "idle",
      phase: "idle",
      message: "",
      completedOrganizations: 0,
      totalOrganizations: 0,
      completedScenarios: 0,
      lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
    });
  }
}

function publishSyncStatus(
  status: Omit<CatalogSyncStatus, "updatedAt">,
  bumpVersionFlag = false,
) {
  setCatalogSyncStatus({
    ...status,
    updatedAt: Date.now(),
  });

  if (bumpVersionFlag) {
    bumpCatalogVersion();
  }
}

function tryAcquireSyncLock(): (() => void) | null {
  ensureCatalogDirectories();

  try {
    writeFileSync(
      LOCK_PATH,
      JSON.stringify({ pid: process.pid, at: Date.now() }),
      {
        flag: "wx",
      },
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

async function writeJsonlFile(filePath: string, rows: ScenarioRow[]) {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, body.length > 0 ? `${body}\n` : "", "utf8");
}

async function writeCatalogFiles(
  manifest: CatalogDiskManifest,
  allRows: ScenarioRow[],
  rowsByOrg: Map<string, ScenarioRow[]>,
) {
  ensureCatalogDirectories();
  const tempGlobalPath = `${GLOBAL_SCENARIOS_PATH}.tmp`;
  const tempManifestPath = `${MANIFEST_PATH}.tmp`;
  const tempOrgsDir = join(CATALOG_DIR, `orgs.tmp-${Date.now()}`);
  const backupOrgsDir = join(CATALOG_DIR, `orgs.backup-${Date.now()}`);

  await mkdir(tempOrgsDir, { recursive: true });
  await writeJsonlFile(tempGlobalPath, allRows);

  for (const [orgKeyValue, rows] of rowsByOrg) {
    await writeJsonlFile(
      join(tempOrgsDir, `${encodeURIComponent(orgKeyValue)}.jsonl`),
      rows,
    );
  }

  await writeFile(tempManifestPath, JSON.stringify(manifest), "utf8");

  if (existsSync(ORGS_DIR)) {
    await rename(ORGS_DIR, backupOrgsDir);
  }

  await rename(tempOrgsDir, ORGS_DIR);
  await rename(tempGlobalPath, GLOBAL_SCENARIOS_PATH);
  await rename(tempManifestPath, MANIFEST_PATH);

  if (existsSync(backupOrgsDir)) {
    await rm(backupOrgsDir, { recursive: true, force: true });
  }

  clearDiskManifestCache();
}

async function buildTeamRows(
  org: Organization,
  team: Team,
  folders: Folder[],
  hooks: Hook[],
  onProgress?: (event: { teamName: string; scenarioCount: number }) => void,
): Promise<ScenarioRow[]> {
  const folderNames = new Map(
    folders.map((folder) => [folder.id, folder.name]),
  );
  const hookUrls = new Map(
    hooks.filter((hook) => hook.url).map((hook) => [hook.id, hook.url]),
  );
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
        folderName: scenario.folderId
          ? (folderNames.get(scenario.folderId) ?? null)
          : null,
        webhookUrl: scenario.hookId
          ? (hookUrls.get(scenario.hookId) ?? null)
          : null,
        isPaused: scenario.isPaused,
        lastEditTs: Date.parse(scenario.lastEdit) || 0,
        updatedByUserId: scenario.updatedByUser?.id ?? null,
      });
    }
  }

  return dedupeScenarioRows(rows);
}

async function syncOrganization(
  org: Organization,
  onProgress?: (event: {
    orgName: string;
    teamName: string;
    scenarioCount: number;
  }) => void,
): Promise<{
  orgRows: ScenarioRow[];
  organizationRows: OrganizationListRow[];
  skipped: boolean;
  skippedName?: string;
  facet: CatalogFacets["organizations"][number] | null;
  teams: CatalogFacets["teamsByOrg"][string];
}> {
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

    const teamRows: ScenarioRow[] = [];
    for (const team of teams) {
      onProgress?.({
        orgName: org.name,
        teamName: team.name,
        scenarioCount: teamRows.length,
      });
      const [folders, hooks] = await Promise.all([
        fetchFolders(org.zone, team.id),
        fetchHooks(org.zone, team.id),
      ]);
      const rows = await buildTeamRows(org, team, folders, hooks, (event) => {
        onProgress?.({
          orgName: org.name,
          teamName: event.teamName,
          scenarioCount: teamRows.length + event.scenarioCount,
        });
      });
      teamRows.push(...rows);
    }

    return {
      orgRows: teamRows,
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
    };
  }
}

async function performCatalogSync() {
  publishSyncStatus({
    status: "running",
    phase: "initializing",
    message: "Preparing local catalog",
    completedOrganizations: 0,
    totalOrganizations: 0,
    completedScenarios: 0,
    lastSuccessfulSyncAt: readDiskManifest()?.lastSuccessfulSyncAt ?? null,
  });

  const currentUserId = await fetchCurrentUserId();

  publishSyncStatus({
    status: "running",
    phase: "discovering",
    message: "Discovering organizations",
    completedOrganizations: 0,
    totalOrganizations: 0,
    completedScenarios: 0,
    lastSuccessfulSyncAt: readDiskManifest()?.lastSuccessfulSyncAt ?? null,
  });

  const organizations = sortOrganizationsByPreviousRecency(
    await fetchOrganizations(),
  );
  const results = new Array<Awaited<ReturnType<typeof syncOrganization>>>(
    organizations.length,
  );
  let completedOrganizations = 0;
  let completedScenarios = 0;
  const pool = createPool(2);

  await Promise.all(
    organizations.map((org, index) =>
      pool.run(async () => {
        publishSyncStatus({
          status: "running",
          phase: "syncing",
          message: `Syncing ${org.name}`,
          completedOrganizations,
          totalOrganizations: organizations.length,
          completedScenarios,
          lastSuccessfulSyncAt:
            readDiskManifest()?.lastSuccessfulSyncAt ?? null,
        });

        results[index] = await syncOrganization(org, (event) => {
          publishSyncStatus({
            status: "running",
            phase: "syncing",
            message: `Syncing ${event.orgName} / ${event.teamName}`,
            completedOrganizations,
            totalOrganizations: organizations.length,
            completedScenarios: completedScenarios + event.scenarioCount,
            lastSuccessfulSyncAt:
              readDiskManifest()?.lastSuccessfulSyncAt ?? null,
          });
        });
        completedOrganizations += 1;
        completedScenarios += results[index]?.orgRows.length ?? 0;

        publishSyncStatus(
          {
            status: "running",
            phase: "syncing",
            message: `Synced ${completedOrganizations} of ${organizations.length} organizations`,
            completedOrganizations,
            totalOrganizations: organizations.length,
            completedScenarios,
            lastSuccessfulSyncAt:
              readDiskManifest()?.lastSuccessfulSyncAt ?? null,
          },
          true,
        );
      }),
    ),
  );

  const allRows: ScenarioRow[] = [];
  const organizationRows: OrganizationListRow[] = [];
  const skippedOrgs: string[] = [];
  const rowsByOrg = new Map<string, ScenarioRow[]>();
  const facets: CatalogFacets = {
    organizations: [],
    teamsByOrg: {},
  };

  for (const result of results) {
    if (!result) continue;

    const orgRows = dedupeScenarioRows(result.orgRows).sort((a, b) =>
      compareScenarioRows(a, b, currentUserId),
    );
    if (result.facet) {
      facets.organizations.push(result.facet);
      facets.teamsByOrg[result.facet.orgKey] = result.teams;
      rowsByOrg.set(result.facet.orgKey, orgRows);
    }

    allRows.push(...orgRows);
    organizationRows.push(...result.organizationRows);

    if (result.skipped && result.skippedName) {
      skippedOrgs.push(result.skippedName);
    }
  }

  const dedupedAllRows = dedupeScenarioRows(allRows);
  dedupedAllRows.sort((a, b) => compareScenarioRows(a, b, currentUserId));
  facets.organizations.sort((a, b) => a.orgName.localeCompare(b.orgName));
  organizationRows.sort(
    (a, b) =>
      a.orgName.localeCompare(b.orgName) ||
      a.teamName.localeCompare(b.teamName),
  );

  const version = Date.now();
  const manifest: CatalogDiskManifest = {
    version,
    lastSuccessfulSyncAt: Date.now(),
    currentUserId,
    defaultScenarioRows: dedupedAllRows.slice(0, PAGE_SIZE),
    organizationRows,
    facets,
    skippedOrgs: skippedOrgs.sort((a, b) => a.localeCompare(b)),
    organizationLastEditTs: getOrganizationLastEditMap(dedupedAllRows),
  };

  publishSyncStatus({
    status: "running",
    phase: "finalizing",
    message: "Refreshing startup cache",
    completedOrganizations: organizations.length,
    totalOrganizations: organizations.length,
    completedScenarios,
    lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
  });

  await writeCatalogFiles(manifest, dedupedAllRows, rowsByOrg);
  const cacheVersion = bumpCatalogVersion();
  await rebuildHotStartManifest({ ...manifest, version: cacheVersion });

  publishSyncStatus({
    status: "idle",
    phase: "idle",
    message: "",
    completedOrganizations: organizations.length,
    totalOrganizations: organizations.length,
    completedScenarios,
    lastSuccessfulSyncAt: manifest.lastSuccessfulSyncAt,
  });
}

export async function searchScenarios(
  params: ScenarioSearchParams = {},
): Promise<PagedResult<ScenarioRow>> {
  return collectPagedScenarioRows(getScenarioFilePath(params), params);
}

export async function listOrgScenarios(
  params: OrganizationScenarioQueryParams,
): Promise<PagedResult<ScenarioRow>> {
  return collectPagedScenarioRows(getOrgShardPath(params.orgKey), params);
}

export async function getScenarioRowsByKeys(
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

  const { rows } = await collectPagedScenarioRows(GLOBAL_SCENARIOS_PATH, {
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

export async function listOrganizations(
  params: OrganizationQueryParams = {},
): Promise<PagedResult<OrganizationListRow>> {
  const manifest = readDiskManifest() ?? getHotStartManifest();
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
  return (
    readDiskManifest()?.facets ??
    getHotStartManifest()?.facets ?? {
      organizations: [],
      teamsByOrg: {},
    }
  );
}

export function getSkippedOrganizations(): string[] {
  return (
    readDiskManifest()?.skippedOrgs ?? getHotStartManifest()?.skippedOrgs ?? []
  );
}

export function hasCatalogData(): boolean {
  return existsSync(MANIFEST_PATH) && existsSync(GLOBAL_SCENARIOS_PATH);
}

export async function syncCatalog({
  force = false,
}: {
  force?: boolean;
} = {}): Promise<void> {
  const currentManifest = readDiskManifest();
  if (
    !force &&
    currentManifest?.lastSuccessfulSyncAt &&
    Date.now() - currentManifest.lastSuccessfulSyncAt < SYNC_TTL_MS
  ) {
    return;
  }

  if (inProcessSync) {
    return inProcessSync;
  }

  const releaseLock = tryAcquireSyncLock();
  if (!releaseLock) {
    if (!hasCatalogData()) {
      await waitForActiveSync();
    }
    return;
  }

  inProcessSync = performCatalogSync()
    .catch((error) => {
      publishSyncStatus({
        status: "error",
        phase: "idle",
        message: "Catalog sync failed",
        completedOrganizations: 0,
        totalOrganizations: 0,
        completedScenarios: 0,
        lastSuccessfulSyncAt: readDiskManifest()?.lastSuccessfulSyncAt ?? null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      releaseLock();
      inProcessSync = null;
    });

  return inProcessSync;
}

export async function ensureCatalogReady(): Promise<void> {
  await verifyCatalogBootstrapState();

  const manifest = readDiskManifest();
  const hasSnapshot = hasCatalogData() || getHotStartManifest() !== null;

  if (!hasSnapshot) {
    await syncCatalog({ force: true });
    return;
  }

  if (
    !manifest?.lastSuccessfulSyncAt ||
    Date.now() - manifest.lastSuccessfulSyncAt > SYNC_TTL_MS
  ) {
    void syncCatalog({ force: true });
  }
}

export { subscribeCatalogVersion };
