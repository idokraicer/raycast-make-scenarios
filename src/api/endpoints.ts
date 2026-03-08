import { getPreferenceValues } from "@raycast/api";
import {
  apiFetch,
  apiFetchAllPages,
  apiFetchAllPagesIterator,
  FetchOptions,
} from "./client.js";
import {
  Folder,
  Hook,
  Organization,
  Scenario,
  ScenarioLog,
  ScenarioUser,
  Team,
  Zone,
} from "./types.js";

function getDiscoveryZone(): Zone {
  return getPreferenceValues<{ zone: Zone }>().zone;
}

type RequestOptions = Pick<FetchOptions, "signal" | "timeoutMs">;
type OrganizationRequestOptions = RequestOptions & { bypassCache?: boolean };

export async function fetchCurrentUserId(
  options?: RequestOptions,
): Promise<number> {
  const data = await apiFetch<{ authUser: { id: number } }>({
    zone: getDiscoveryZone(),
    path: "/users/me",
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  });
  return data.authUser.id;
}

let cachedOrgs: { data: Organization[]; timestamp: number } | null = null;
const ORG_CACHE_TTL_MS = 10_000;

export async function fetchOrganizations(
  options?: OrganizationRequestOptions,
): Promise<Organization[]> {
  if (
    !options?.bypassCache &&
    cachedOrgs &&
    Date.now() - cachedOrgs.timestamp < ORG_CACHE_TTL_MS
  ) {
    return cachedOrgs.data;
  }
  const data = await apiFetchAllPages<Organization>(
    {
      zone: getDiscoveryZone(),
      path: "/organizations",
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "organizations",
  );
  cachedOrgs = { data, timestamp: Date.now() };
  return data;
}

export async function fetchTeams(
  zone: Zone,
  organizationId: number,
  options?: RequestOptions,
): Promise<Team[]> {
  return apiFetchAllPages<Team>(
    {
      zone,
      path: "/teams",
      params: { organizationId: String(organizationId) },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "teams",
  );
}

export async function fetchScenarios(
  zone: Zone,
  teamId: number,
  options?: RequestOptions,
): Promise<Scenario[]> {
  return apiFetchAllPages<Scenario>(
    {
      zone,
      path: "/scenarios",
      params: { teamId: String(teamId) },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "scenarios",
  );
}

export function fetchScenarioPages(
  zone: Zone,
  teamId: number,
  options?: RequestOptions,
): AsyncGenerator<Scenario[], void, void> {
  return apiFetchAllPagesIterator<Scenario>(
    {
      zone,
      path: "/scenarios",
      params: { teamId: String(teamId) },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "scenarios",
  );
}

export async function fetchHooks(
  zone: Zone,
  teamId: number,
  options?: RequestOptions,
): Promise<Hook[]> {
  return apiFetchAllPages<Hook>(
    {
      zone,
      path: "/hooks",
      params: { teamId: String(teamId) },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "hooks",
  );
}

export async function fetchFolders(
  zone: Zone,
  teamId: number,
  options?: RequestOptions,
): Promise<Folder[]> {
  return apiFetchAllPages<Folder>(
    {
      zone,
      path: "/scenarios-folders",
      params: { teamId: String(teamId) },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "scenariosFolders",
  );
}

export async function fetchUsers(
  zone: Zone,
  teamId: number,
  options?: RequestOptions,
): Promise<ScenarioUser[]> {
  return apiFetchAllPages<ScenarioUser>(
    {
      zone,
      path: "/users",
      params: { teamId: String(teamId) },
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    },
    "users",
  );
}

export async function fetchScenarioLogs(
  zone: Zone,
  scenarioId: number,
  options?: RequestOptions,
): Promise<ScenarioLog[]> {
  const data = await apiFetch<{ scenarioLogs: ScenarioLog[] }>({
    zone,
    path: `/scenarios/${scenarioId}/logs`,
    params: {
      "pg[sortDir]": "desc",
      "pg[limit]": "50",
    },
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  });
  return data.scenarioLogs;
}
