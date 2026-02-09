import { apiFetch, apiFetchAllPages } from "./client.js";
import {
  DISCOVERY_ZONE,
  Folder,
  Hook,
  Organization,
  Scenario,
  Team,
  Zone,
} from "./types.js";

export async function fetchCurrentUserId(): Promise<number> {
  const data = await apiFetch<{ authUser: { id: number } }>({
    zone: DISCOVERY_ZONE,
    path: "/users/me",
  });
  return data.authUser.id;
}

export async function fetchOrganizations(): Promise<Organization[]> {
  return apiFetchAllPages<Organization>(
    { zone: DISCOVERY_ZONE, path: "/organizations" },
    "organizations",
  );
}

export async function fetchTeams(
  zone: Zone,
  organizationId: number,
): Promise<Team[]> {
  return apiFetchAllPages<Team>(
    {
      zone,
      path: "/teams",
      params: { organizationId: String(organizationId) },
    },
    "teams",
  );
}

export async function fetchScenarios(
  zone: Zone,
  teamId: number,
): Promise<Scenario[]> {
  return apiFetchAllPages<Scenario>(
    { zone, path: "/scenarios", params: { teamId: String(teamId) } },
    "scenarios",
  );
}

export async function fetchHooks(
  zone: Zone,
  teamId: number,
): Promise<Hook[]> {
  return apiFetchAllPages<Hook>(
    { zone, path: "/hooks", params: { teamId: String(teamId) } },
    "hooks",
  );
}

export async function fetchFolders(
  zone: Zone,
  teamId: number,
): Promise<Folder[]> {
  return apiFetchAllPages<Folder>(
    { zone, path: "/scenarios-folders", params: { teamId: String(teamId) } },
    "scenariosFolders",
  );
}
