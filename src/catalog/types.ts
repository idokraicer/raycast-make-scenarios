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
  folderId: number | null;
  folderName: string | null;
  hookId: number | null;
  webhookUrl: string | null;
  metadataState: "pending" | "ready";
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
  isPartial: boolean;
  indexedScenarioCount: number;
  defaultScenarioRows: ScenarioRow[];
  pinnedRows: ScenarioRow[];
  recentRows: ScenarioRow[];
  organizationRows: OrganizationListRow[];
  facets: CatalogFacets;
  skippedOrgs: string[];
}

export interface CatalogDiskManifest {
  schemaVersion: number;
  version: number;
  lastSuccessfulSyncAt: number | null;
  currentUserId: number | null;
  indexedScenarioCount: number;
  indexedOrgKeys: string[];
  enrichmentPendingOrgKeys: string[];
  organizationLastEditTs: Record<string, number>;
  defaultScenarioRows: ScenarioRow[];
  organizationRows: OrganizationListRow[];
  facets: CatalogFacets;
  skippedOrgs: string[];
}

export type CatalogSyncPhase =
  | "idle"
  | "discovering"
  | "indexing"
  | "enriching"
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
