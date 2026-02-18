import { getPreferenceValues } from "@raycast/api";
import { apiFetch, apiFetchAllPages, FetchOptions } from "./client.js";
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

type SignalOption = Pick<FetchOptions, "signal">;

export async function fetchCurrentUserId(
  options?: SignalOption,
): Promise<number> {
  const data = await apiFetch<{ authUser: { id: number } }>({
    zone: getDiscoveryZone(),
    path: "/users/me",
    signal: options?.signal,
  });
  return data.authUser.id;
}

export async function fetchOrganizations(
  options?: SignalOption,
): Promise<Organization[]> {
  return apiFetchAllPages<Organization>(
    {
      zone: getDiscoveryZone(),
      path: "/organizations",
      signal: options?.signal,
    },
    "organizations",
  );
}

export async function fetchTeams(
  zone: Zone,
  organizationId: number,
  options?: SignalOption,
): Promise<Team[]> {
  return apiFetchAllPages<Team>(
    {
      zone,
      path: "/teams",
      params: { organizationId: String(organizationId) },
      signal: options?.signal,
    },
    "teams",
  );
}

export async function fetchScenarios(
  zone: Zone,
  teamId: number,
  options?: SignalOption,
): Promise<Scenario[]> {
  return apiFetchAllPages<Scenario>(
    {
      zone,
      path: "/scenarios",
      params: { teamId: String(teamId) },
      signal: options?.signal,
    },
    "scenarios",
  );
}

export async function fetchHooks(
  zone: Zone,
  teamId: number,
  options?: SignalOption,
): Promise<Hook[]> {
  return apiFetchAllPages<Hook>(
    {
      zone,
      path: "/hooks",
      params: { teamId: String(teamId) },
      signal: options?.signal,
    },
    "hooks",
  );
}

export async function fetchFolders(
  zone: Zone,
  teamId: number,
  options?: SignalOption,
): Promise<Folder[]> {
  return apiFetchAllPages<Folder>(
    {
      zone,
      path: "/scenarios-folders",
      params: { teamId: String(teamId) },
      signal: options?.signal,
    },
    "scenariosFolders",
  );
}

export async function fetchUsers(
  zone: Zone,
  teamId: number,
  options?: SignalOption,
): Promise<ScenarioUser[]> {
  return apiFetchAllPages<ScenarioUser>(
    {
      zone,
      path: "/users",
      params: { teamId: String(teamId) },
      signal: options?.signal,
    },
    "users",
  );
}

export async function fetchScenarioLogs(
  zone: Zone,
  scenarioId: number,
  options?: SignalOption,
): Promise<ScenarioLog[]> {
  const data = await apiFetch<{ scenarioLogs: ScenarioLog[] }>({
    zone,
    path: `/scenarios/${scenarioId}/logs`,
    params: {
      "pg[sortDir]": "desc",
      "pg[limit]": "50",
    },
    signal: options?.signal,
  });
  return data.scenarioLogs;
}
