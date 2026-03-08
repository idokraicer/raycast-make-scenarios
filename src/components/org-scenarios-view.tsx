import { Icon, List } from "@raycast/api";
import { useState } from "react";
import { ScenarioRow } from "../catalog/types.js";
import { useCatalogFacets } from "../hooks/use-catalog-facets.js";
import { useOrgScenarioList } from "../hooks/use-org-scenario-list.js";
import { ScenarioListItem } from "./scenario-list-item.js";

export function OrgScenariosView({
  orgKey,
  orgName,
  isPinned,
  onTogglePin,
  onVisit,
  onRefresh,
}: {
  orgKey: string;
  orgName: string;
  isPinned: (key: string) => boolean;
  onTogglePin: (key: string) => void;
  onVisit: (key: string) => void;
  onRefresh: () => void;
}) {
  const [teamFilter, setTeamFilter] = useState("all");
  const [searchText, setSearchText] = useState("");
  const facets = useCatalogFacets();
  const teams = facets.teamsByOrg[orgKey] ?? [];
  const scenarios = useOrgScenarioList({
    orgKey,
    query: searchText,
    teamKey: teamFilter === "all" ? undefined : teamFilter,
  });

  return (
    <List
      isLoading={scenarios.isLoading}
      navigationTitle={orgName}
      searchBarPlaceholder={`Search scenarios in ${orgName}...`}
      onSearchTextChange={setSearchText}
      throttle
      searchBarAccessory={
        teams.length > 1 ? (
          <List.Dropdown tooltip="Filter by Team" onChange={setTeamFilter}>
            <List.Dropdown.Item title="All Teams" value="all" />
            {teams.map((team) => (
              <List.Dropdown.Item
                key={team.teamKey}
                title={team.teamName}
                value={team.teamKey}
              />
            ))}
          </List.Dropdown>
        ) : undefined
      }
      pagination={{
        pageSize: scenarios.pageSize,
        hasMore: scenarios.hasMore,
        onLoadMore: scenarios.loadMore,
      }}
    >
      {scenarios.rows.length === 0 && (
        <List.EmptyView
          title="No scenarios found"
          description={`No scenarios in ${orgName}`}
          icon={Icon.MagnifyingGlass}
        />
      )}
      {scenarios.rows.map((item: ScenarioRow) => (
        <ScenarioListItem
          key={item.key}
          item={item}
          isPinned={isPinned(item.key)}
          onTogglePin={() => onTogglePin(item.key)}
          onVisit={() => onVisit(item.key)}
          onRefresh={onRefresh}
        />
      ))}
    </List>
  );
}
