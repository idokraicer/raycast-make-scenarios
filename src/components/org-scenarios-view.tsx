import { Icon, List } from "@raycast/api";
import { useMemo, useState } from "react";
import { Organization, ScenarioItem, Team } from "../api/types.js";
import { ScenarioListItem } from "./scenario-list-item.js";

export function OrgScenariosView({
  org,
  scenarios,
  onRefresh,
}: {
  org: Organization;
  scenarios: ScenarioItem[];
  onRefresh: () => void;
}) {
  const [teamFilter, setTeamFilter] = useState<string>("all");

  const teams = useMemo(() => {
    const seen = new Set<number>();
    return scenarios.reduce<Team[]>((acc, item) => {
      if (!seen.has(item.team.id)) {
        seen.add(item.team.id);
        acc.push(item.team);
      }
      return acc;
    }, []);
  }, [scenarios]);

  const filtered =
    teamFilter === "all"
      ? scenarios
      : scenarios.filter((i) => i.team.id === Number(teamFilter));

  return (
    <List
      navigationTitle={org.name}
      searchBarPlaceholder={`Search scenarios in ${org.name}...`}
      searchBarAccessory={
        teams.length > 1 ? (
          <List.Dropdown tooltip="Filter by Team" onChange={setTeamFilter}>
            <List.Dropdown.Item title="All Teams" value="all" />
            {teams.map((team) => (
              <List.Dropdown.Item
                key={team.id}
                title={team.name}
                value={String(team.id)}
              />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      {filtered.length === 0 && (
        <List.EmptyView
          title="No scenarios found"
          description={`No scenarios in ${org.name}`}
          icon={Icon.MagnifyingGlass}
        />
      )}
      {filtered.map((item) => (
        <ScenarioListItem
          key={`${item.org.zone}-${item.team.id}-${item.scenario.id}`}
          item={item}
          onRefresh={onRefresh}
        />
      ))}
    </List>
  );
}
