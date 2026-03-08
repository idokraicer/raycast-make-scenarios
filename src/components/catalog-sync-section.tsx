import { Color, Icon, List } from "@raycast/api";
import { CatalogSyncStatus } from "../catalog/types.js";

function buildProgressSubtitle(status: CatalogSyncStatus) {
  const parts: string[] = [];

  if (status.totalOrganizations > 0) {
    parts.push(
      `${status.completedOrganizations}/${status.totalOrganizations} orgs`,
    );
  }

  if (status.completedScenarios > 0) {
    parts.push(`${status.completedScenarios} scenarios`);
  }

  return parts.join(" • ");
}

export function CatalogSyncSection({
  status,
}: {
  status: CatalogSyncStatus & { isRunning: boolean; hasError: boolean };
}) {
  if (!status.isRunning && !status.hasError) {
    return null;
  }

  const subtitle = buildProgressSubtitle(status);

  return (
    <List.Section title={status.hasError ? "Sync Error" : "Catalog Sync"}>
      <List.Item
        title={
          status.hasError
            ? "Catalog sync failed"
            : status.message || "Syncing catalog"
        }
        subtitle={subtitle || undefined}
        icon={{
          source: status.hasError ? Icon.ExclamationMark : Icon.ArrowClockwise,
          tintColor: status.hasError ? Color.Red : Color.Blue,
        }}
        accessories={
          status.phase !== "idle"
            ? [{ tag: { value: status.phase, color: Color.SecondaryText } }]
            : undefined
        }
      />
    </List.Section>
  );
}
