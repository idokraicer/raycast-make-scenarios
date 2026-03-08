import { CatalogSyncStatus } from "../catalog/types.js";

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
  switch (status.phase) {
    case "discovering":
      return "Discovering organizations";
    case "indexing": {
      const orgName = parseActiveOrgName(status);
      if (orgName) {
        return status.totalOrganizations > 0
          ? `Indexing ${orgName} (${status.completedOrganizations}/${status.totalOrganizations})`
          : `Indexing ${orgName}`;
      }
      return status.totalOrganizations > 0
        ? `Indexing ${status.completedOrganizations}/${status.totalOrganizations}`
        : "Indexing";
    }
    case "finalizing":
      return "Finalizing";
    case "enriching": {
      const orgName = parseActiveOrgName(status);
      return orgName ? `Enriching ${orgName}` : "Enriching metadata";
    }
    case "idle":
    default:
      return "Syncing";
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
