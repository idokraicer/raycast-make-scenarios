import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  showToast,
} from "@raycast/api";
import { syncCatalog } from "./catalog/service.js";
import { OrganizationListRow } from "./catalog/types.js";
import { OrgScenariosView } from "./components/org-scenarios-view.js";
import { SkippedOrgsSection } from "./components/skipped-orgs-section.js";
import { useCatalogSyncStatus } from "./hooks/use-catalog-sync-status.js";
import { useOrganizationList } from "./hooks/use-organization-list.js";
import { usePinned } from "./hooks/use-pinned.js";
import { useRecents } from "./hooks/use-recents.js";
import { useSkippedOrganizations } from "./hooks/use-skipped-organizations.js";
import { buildOrgScenariosUrl, zoneLabel } from "./utils/url.js";
import { useState } from "react";

export default function SearchOrganizations() {
  const [searchText, setSearchText] = useState("");
  const organizations = useOrganizationList({ query: searchText });
  const pinned = usePinned();
  const recents = useRecents();
  const syncStatus = useCatalogSyncStatus();
  const skippedOrgs = useSkippedOrganizations();

  const refresh = async () => {
    try {
      await syncCatalog({ force: true });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to refresh catalog",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const isLoading = syncStatus.isRunning || organizations.isLoading;

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search organizations..."
      onSearchTextChange={setSearchText}
      throttle
      pagination={{
        pageSize: organizations.pageSize,
        hasMore: organizations.hasMore,
        onLoadMore: organizations.loadMore,
      }}
    >
      {!isLoading && organizations.rows.length === 0 && (
        <List.EmptyView
          title="No organizations found"
          description="Check your API token and zone in extension preferences."
          icon={Icon.MagnifyingGlass}
        />
      )}
      {organizations.rows.map((item: OrganizationListRow) => {
        const url = buildOrgScenariosUrl(item.zone, item.teamId);

        return (
          <List.Item
            key={`${item.orgKey}-${item.teamKey}`}
            title={item.orgName}
            subtitle={item.teamName}
            accessories={[
              { tag: { value: zoneLabel(item.zone), color: Color.Blue } },
            ]}
            icon={Icon.Building}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser title="Open Scenarios" url={url} />
                <Action.Push
                  title="View Scenarios"
                  icon={Icon.List}
                  shortcut={{ key: "tab", modifiers: [] }}
                  target={
                    <OrgScenariosView
                      orgKey={item.orgKey}
                      orgName={item.orgName}
                      isPinned={pinned.isPinned}
                      onTogglePin={pinned.togglePin}
                      onVisit={recents.recordVisit}
                      onRefresh={refresh}
                    />
                  }
                />
                <Action.CopyToClipboard
                  title="Copy URL"
                  content={url}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                />
                <Action
                  title="Refresh"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={refresh}
                />
              </ActionPanel>
            }
          />
        );
      })}
      <SkippedOrgsSection names={skippedOrgs} />
    </List>
  );
}
