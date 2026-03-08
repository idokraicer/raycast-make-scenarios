import {
  Action,
  ActionPanel,
  Color,
  Icon,
  List,
  Toast,
  showToast,
} from "@raycast/api";
import { useCallback, useMemo, useState } from "react";
import { syncCatalog } from "./catalog/service.js";
import { OrganizationListRow, ScenarioRow } from "./catalog/types.js";
import {
  useCatalogSearch,
  usePinnedScenarioRows,
  useRecentScenarioRows,
} from "./hooks/use-catalog-search.js";
import { useCatalogFacets } from "./hooks/use-catalog-facets.js";
import { useCatalogSyncStatus } from "./hooks/use-catalog-sync-status.js";
import { useOrganizationList } from "./hooks/use-organization-list.js";
import { usePinned } from "./hooks/use-pinned.js";
import { useRecents } from "./hooks/use-recents.js";
import { useSkippedOrganizations } from "./hooks/use-skipped-organizations.js";
import { ScenarioListItem } from "./components/scenario-list-item.js";
import { OrgScenariosView } from "./components/org-scenarios-view.js";
import { CatalogSyncSection } from "./components/catalog-sync-section.js";
import { SkippedOrgsSection } from "./components/skipped-orgs-section.js";
import { buildOrgScenariosUrl, zoneLabel } from "./utils/url.js";
import { parseDropdownFilter, parseSearchText } from "./utils/search-filter.js";

export default function SearchMake() {
  const [dropdownValue, setDropdownValue] = useState("type:all");
  const [searchText, setSearchText] = useState("");
  const pinned = usePinned();
  const recents = useRecents();
  const facets = useCatalogFacets();
  const syncStatus = useCatalogSyncStatus();
  const skippedOrgs = useSkippedOrganizations();

  const filter = useMemo(
    () => parseDropdownFilter(dropdownValue),
    [dropdownValue],
  );
  const parsed = useMemo(
    () =>
      parseSearchText(
        searchText,
        filter.kind === "type" ? filter.value : "all",
      ),
    [filter, searchText],
  );

  const showScenarios =
    !parsed.orgPrefix && filter.kind !== "type"
      ? true
      : !parsed.orgPrefix && filter.kind === "type"
        ? filter.value !== "organizations"
        : false;
  const showOrgs = parsed.orgPrefix
    ? true
    : filter.kind === "type"
      ? filter.value !== "scenarios"
      : false;

  const scenarioQuery = showScenarios ? searchText : "";
  const orgQuery = parsed.orgPrefix
    ? parsed.orgSearchQuery
    : showOrgs
      ? searchText
      : "";
  const statusFilter = filter.kind === "status" ? filter.value : "all";
  const orgFilter = filter.kind === "org" ? filter.value : undefined;

  const recentIds = useMemo(
    () => recents.recentIds.filter((id) => !pinned.pinnedIds.includes(id)),
    [pinned.pinnedIds, recents.recentIds],
  );
  const hiddenScenarioKeys = useMemo(
    () => [...pinned.pinnedIds, ...recentIds],
    [pinned.pinnedIds, recentIds],
  );

  const pinnedRows = usePinnedScenarioRows(
    pinned.pinnedIds,
    { query: scenarioQuery, status: statusFilter, orgKey: orgFilter },
    { enabled: showScenarios },
  );
  const recentRows = useRecentScenarioRows(
    recentIds,
    { query: scenarioQuery, status: statusFilter, orgKey: orgFilter },
    { enabled: showScenarios },
  );
  const scenarioRows = useCatalogSearch(
    {
      query: scenarioQuery,
      status: statusFilter,
      orgKey: orgFilter,
      excludeKeys: hiddenScenarioKeys,
    },
    { enabled: showScenarios },
  );
  const organizationRows = useOrganizationList(
    { query: orgQuery },
    { enabled: showOrgs },
  );

  const isLoading =
    pinned.isLoading ||
    recents.isLoading ||
    (syncStatus.isRunning &&
      pinnedRows.rows.length === 0 &&
      recentRows.rows.length === 0 &&
      scenarioRows.rows.length === 0 &&
      organizationRows.rows.length === 0);

  const hasResults =
    (showScenarios &&
      (pinnedRows.rows.length > 0 ||
        recentRows.rows.length > 0 ||
        scenarioRows.rows.length > 0)) ||
    (showOrgs && organizationRows.rows.length > 0);

  const refresh = useCallback(async () => {
    try {
      await syncCatalog({ force: true });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to refresh catalog",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const loadMore = useCallback(() => {
    if (showScenarios && scenarioRows.hasMore) {
      scenarioRows.loadMore();
    }
    if (showOrgs && organizationRows.hasMore) {
      organizationRows.loadMore();
    }
  }, [organizationRows, scenarioRows, showOrgs, showScenarios]);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Make.com... (type > for orgs)"
      onSearchTextChange={setSearchText}
      searchBarAccessory={
        <List.Dropdown tooltip="Filter" onChange={setDropdownValue} storeValue>
          <List.Dropdown.Section title="Type">
            <List.Dropdown.Item title="All" value="type:all" />
            <List.Dropdown.Item title="Scenarios" value="type:scenarios" />
            <List.Dropdown.Item
              title="Organizations"
              value="type:organizations"
            />
          </List.Dropdown.Section>
          <List.Dropdown.Section title="Status">
            <List.Dropdown.Item title="Active Only" value="status:active" />
            <List.Dropdown.Item title="Paused Only" value="status:paused" />
          </List.Dropdown.Section>
          {facets.organizations.length > 1 && (
            <List.Dropdown.Section title="Organization">
              {facets.organizations.map((org) => (
                <List.Dropdown.Item
                  key={org.orgKey}
                  title={org.orgName}
                  value={`org:${org.orgKey}`}
                />
              ))}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
      throttle
      pagination={{
        pageSize: Math.max(scenarioRows.pageSize, organizationRows.pageSize),
        hasMore:
          (showScenarios && scenarioRows.hasMore) ||
          (showOrgs && organizationRows.hasMore),
        onLoadMore: loadMore,
      }}
    >
      {!isLoading && !hasResults && (
        <List.EmptyView
          title={
            syncStatus.isRunning && !syncStatus.message
              ? "Loading catalog..."
              : syncStatus.isRunning
                ? syncStatus.message
                : "No results found"
          }
          description={
            syncStatus.isRunning
              ? syncStatus.totalOrganizations > 0
                ? `${syncStatus.completedOrganizations}/${syncStatus.totalOrganizations} organizations, ${syncStatus.completedScenarios} scenarios discovered so far.`
                : "The local catalog is syncing in the background."
              : "Check your API token and zone in extension preferences."
          }
          icon={Icon.MagnifyingGlass}
        />
      )}
      <CatalogSyncSection status={syncStatus} />
      {showScenarios && pinnedRows.rows.length > 0 && (
        <List.Section
          title="Pinned"
          subtitle={String(pinnedRows.totalCount ?? pinnedRows.rows.length)}
        >
          {pinnedRows.rows.map((item: ScenarioRow) => (
            <ScenarioListItem
              key={item.key}
              item={item}
              isPinned={pinned.isPinned(item.key)}
              onTogglePin={() => pinned.togglePin(item.key)}
              onVisit={() => recents.recordVisit(item.key)}
              onRefresh={refresh}
            />
          ))}
        </List.Section>
      )}
      {showScenarios && recentRows.rows.length > 0 && (
        <List.Section
          title="Recent"
          subtitle={String(recentRows.totalCount ?? recentRows.rows.length)}
        >
          {recentRows.rows.map((item: ScenarioRow) => (
            <ScenarioListItem
              key={item.key}
              item={item}
              isPinned={pinned.isPinned(item.key)}
              onTogglePin={() => pinned.togglePin(item.key)}
              onVisit={() => recents.recordVisit(item.key)}
              onRefresh={refresh}
            />
          ))}
        </List.Section>
      )}
      {showScenarios && (
        <List.Section
          title="Scenarios"
          subtitle={String(scenarioRows.totalCount ?? scenarioRows.rows.length)}
        >
          {scenarioRows.rows.map((item: ScenarioRow) => (
            <ScenarioListItem
              key={item.key}
              item={item}
              isPinned={pinned.isPinned(item.key)}
              onTogglePin={() => pinned.togglePin(item.key)}
              onVisit={() => recents.recordVisit(item.key)}
              onRefresh={refresh}
            />
          ))}
        </List.Section>
      )}
      {showOrgs && (
        <List.Section
          title="Organizations"
          subtitle={String(
            organizationRows.totalCount ?? organizationRows.rows.length,
          )}
        >
          {organizationRows.rows.map((item: OrganizationListRow) => {
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
        </List.Section>
      )}
      <SkippedOrgsSection names={skippedOrgs} />
    </List>
  );
}
