import { Icon, List, Toast, showToast } from "@raycast/api";
import { useMemo, useState } from "react";
import { syncCatalog } from "./catalog/service.js";
import { ScenarioRow } from "./catalog/types.js";
import { CatalogSyncSection } from "./components/catalog-sync-section.js";
import { ScenarioListItem } from "./components/scenario-list-item.js";
import { SkippedOrgsSection } from "./components/skipped-orgs-section.js";
import { useCatalogFacets } from "./hooks/use-catalog-facets.js";
import { useCatalogSearch } from "./hooks/use-catalog-search.js";
import { useCatalogSyncStatus } from "./hooks/use-catalog-sync-status.js";
import { usePinned } from "./hooks/use-pinned.js";
import { useRecents } from "./hooks/use-recents.js";
import { useSkippedOrganizations } from "./hooks/use-skipped-organizations.js";
import { buildCatalogSyncNavigationTitle } from "./utils/catalog-sync-title.js";

export default function SearchScenarios() {
  const [filter, setFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const pinned = usePinned();
  const recents = useRecents();
  const facets = useCatalogFacets();
  const syncStatus = useCatalogSyncStatus();
  const skippedOrgs = useSkippedOrganizations();

  const parsedFilter = useMemo(() => {
    if (filter.startsWith("org:")) {
      return { orgKey: filter.slice(4), teamKey: undefined };
    }
    if (filter.startsWith("team:")) {
      return { orgKey: undefined, teamKey: filter.slice(5) };
    }
    return { orgKey: undefined, teamKey: undefined };
  }, [filter]);

  const scenarios = useCatalogSearch({
    query: searchText,
    orgKey: parsedFilter.orgKey,
    teamKey: parsedFilter.teamKey,
  });

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

  return (
    <List
      isLoading={
        scenarios.rows.length === 0 &&
        (syncStatus.isRunning || scenarios.isLoading)
      }
      searchBarPlaceholder="Search scenarios..."
      onSearchTextChange={setSearchText}
      throttle
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Organization / Team"
          onChange={setFilter}
        >
          <List.Dropdown.Item title="All" value="all" />
          {facets.organizations.map((org) => (
            <List.Dropdown.Section key={org.orgKey} title={org.orgName}>
              <List.Dropdown.Item
                title={`All in ${org.orgName}`}
                value={`org:${org.orgKey}`}
              />
              {(facets.teamsByOrg[org.orgKey] ?? []).map((team) => (
                <List.Dropdown.Item
                  key={team.teamKey}
                  title={team.teamName}
                  value={`team:${team.teamKey}`}
                />
              ))}
            </List.Dropdown.Section>
          ))}
        </List.Dropdown>
      }
      pagination={{
        pageSize: scenarios.pageSize,
        hasMore: scenarios.hasMore,
        onLoadMore: scenarios.loadMore,
      }}
      navigationTitle={buildCatalogSyncNavigationTitle(
        `Scenarios (${scenarios.totalCount ?? scenarios.rows.length})`,
        syncStatus,
      )}
    >
      {syncStatus.isRunning && scenarios.rows.length === 0 && (
        <List.EmptyView
          title={syncStatus.message || "Syncing scenarios..."}
          description={
            syncStatus.totalOrganizations > 0
              ? `${syncStatus.completedOrganizations}/${syncStatus.totalOrganizations} organizations, ${syncStatus.completedScenarios} scenarios discovered so far.`
              : "Building the local catalog for the first time."
          }
          icon={Icon.ArrowClockwise}
        />
      )}
      {!syncStatus.isRunning && scenarios.rows.length === 0 && (
        <List.EmptyView
          title="No scenarios found"
          description="Check your API token and zone in extension preferences."
          icon={Icon.MagnifyingGlass}
        />
      )}
      <CatalogSyncSection status={syncStatus} />
      {scenarios.rows.map((item: ScenarioRow) => (
        <ScenarioListItem
          key={item.key}
          item={item}
          isPinned={pinned.isPinned(item.key)}
          onTogglePin={() => pinned.togglePin(item.key)}
          onVisit={() => recents.recordVisit(item.key)}
          onRefresh={refresh}
        />
      ))}
      <SkippedOrgsSection names={skippedOrgs} />
    </List>
  );
}
