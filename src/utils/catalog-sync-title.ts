import { CatalogSyncStatus } from "../catalog/types.js";

function isBackgroundRefresh(
  status: CatalogSyncStatus & { isRunning: boolean; hasError: boolean },
): boolean {
  return status.lastSuccessfulSyncAt !== null;
}

function parseActiveOrgName(
  status: CatalogSyncStatus & { isRunning: boolean; hasError: boolean },
): string | null {
  const message = status.message.trim();
  if (!message) {
    return null;
  }

  if (message.startsWith("Indexing ")) {
    return message.slice("Indexing ".length).split(" / ")[0]?.trim() || null;
  }

  if (message.startsWith("Enriching ")) {
    const orgName = message.slice("Enriching ".length).split(" / ")[0]?.trim();
    if (!orgName || orgName === "scenario metadata") {
      return null;
    }
    return orgName;
  }

  return null;
}

function buildSyncLabel(
  status: CatalogSyncStatus & { isRunning: boolean; hasError: boolean },
): string {
  const refreshPrefix = isBackgroundRefresh(status) ? "Refreshing" : "Indexing";

  switch (status.phase) {
    case "discovering":
      return isBackgroundRefresh(status)
        ? "Refreshing catalog"
        : "Discovering organizations";
    case "indexing": {
      const orgName = parseActiveOrgName(status);
      if (orgName) {
        return status.totalOrganizations > 0
          ? `${refreshPrefix} ${orgName} (${status.completedOrganizations}/${status.totalOrganizations})`
          : `${refreshPrefix} ${orgName}`;
      }
      return status.totalOrganizations > 0
        ? `${refreshPrefix} ${status.completedOrganizations}/${status.totalOrganizations}`
        : refreshPrefix;
    }
    case "finalizing":
      return isBackgroundRefresh(status) ? "Refreshing catalog" : "Finalizing";
    case "enriching": {
      const orgName = parseActiveOrgName(status);
      if (orgName) {
        return isBackgroundRefresh(status)
          ? `Refreshing ${orgName}`
          : `Enriching ${orgName}`;
      }
      return isBackgroundRefresh(status)
        ? "Refreshing metadata"
        : "Enriching metadata";
    }
    case "idle":
    default:
      return isBackgroundRefresh(status) ? "Refreshing catalog" : "Syncing";
  }
}

export function buildCatalogSyncNavigationTitle(
  baseTitle: string,
  status: CatalogSyncStatus & { isRunning: boolean; hasError: boolean },
): string {
  if (status.hasError) {
    return `${baseTitle} • Sync Error`;
  }

  if (!status.isRunning) {
    return baseTitle;
  }

  return `${baseTitle} • ${buildSyncLabel(status)}`;
}
