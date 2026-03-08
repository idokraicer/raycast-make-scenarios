export type ScenarioStatusFilter = "all" | "active" | "paused";

export interface ScenarioRow {
  key: string;
  scenarioId: number;
  scenarioName: string;
  orgKey: string;
  orgId: number;
  orgName: string;
  zone: string;
  teamKey: string;
  teamId: number;
  teamName: string;
  folderName: string | null;
  webhookUrl: string | null;
  isPaused: boolean;
  lastEditTs: number;
  updatedByUserId: number | null;
}

export interface OrganizationListRow {
  orgKey: string;
  orgId: number;
  orgName: string;
  zone: string;
  teamKey: string;
  teamId: number;
  teamName: string;
}

export interface OrganizationFacet {
  orgKey: string;
  orgId: number;
  orgName: string;
  zone: string;
}

export interface TeamFacet {
  teamKey: string;
  teamId: number;
  teamName: string;
}

export interface CatalogFacets {
  organizations: OrganizationFacet[];
  teamsByOrg: Record<string, TeamFacet[]>;
}

export interface ScenarioSearchParams {
  query?: string;
  status?: ScenarioStatusFilter;
  orgKey?: string;
  teamKey?: string;
  includeKeys?: string[];
  excludeKeys?: string[];
  limit?: number;
  offset?: number;
}

export interface OrganizationQueryParams {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface OrganizationScenarioQueryParams {
  orgKey: string;
  query?: string;
  teamKey?: string;
  limit?: number;
  offset?: number;
}

export interface PagedResult<T> {
  rows: T[];
  hasMore: boolean;
  totalCount: number;
}

export interface CatalogHotStartManifest {
  version: number;
  lastSuccessfulSyncAt: number | null;
  defaultScenarioRows: ScenarioRow[];
  pinnedRows: ScenarioRow[];
  recentRows: ScenarioRow[];
  organizationRows: OrganizationListRow[];
  facets: CatalogFacets;
  skippedOrgs: string[];
}

export interface CatalogDiskManifest {
  version: number;
  lastSuccessfulSyncAt: number | null;
  currentUserId: number | null;
  defaultScenarioRows: ScenarioRow[];
  organizationRows: OrganizationListRow[];
  facets: CatalogFacets;
  skippedOrgs: string[];
  organizationLastEditTs: Record<string, number>;
}

export type CatalogSyncPhase =
  | "idle"
  | "initializing"
  | "discovering"
  | "syncing"
  | "finalizing";

export interface CatalogSyncStatus {
  status: "idle" | "running" | "error";
  phase: CatalogSyncPhase;
  message: string;
  completedOrganizations: number;
  totalOrganizations: number;
  completedScenarios: number;
  lastSuccessfulSyncAt: number | null;
  updatedAt: number;
  errorMessage?: string;
}
