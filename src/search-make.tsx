import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useMemo, useState } from "react";
import { useOrganizations } from "./hooks/use-organizations.js";
import { useScenarios } from "./hooks/use-scenarios.js";
import { usePinned } from "./hooks/use-pinned.js";
import { useRecents } from "./hooks/use-recents.js";
import { ScenarioListItem } from "./components/scenario-list-item.js";
import { OrgScenariosView } from "./components/org-scenarios-view.js";
import { SkippedOrgsSection } from "./components/skipped-orgs-section.js";
import { buildOrgScenariosUrl, zoneLabel } from "./utils/url.js";
import { scenarioItemKey } from "./utils/scenario-key.js";
import {
  parseSearchText,
  filterOrgs,
  parseDropdownFilter,
  applyDropdownFilter,
} from "./utils/search-filter.js";
import { Organization, ScenarioItem } from "./api/types.js";

export default function SearchMake() {
  const orgs = useOrganizations();
  const scenarios = useScenarios();
  const pinned = usePinned();
  const recents = useRecents();
  const [dropdownValue, setDropdownValue] = useState("type:all");
  const [searchText, setSearchText] = useState("");

  const isLoading =
    orgs.isLoading ||
    scenarios.isLoading ||
    pinned.isLoading ||
    recents.isLoading;

  const filter = useMemo(
    () => parseDropdownFilter(dropdownValue),
    [dropdownValue],
  );
  const parsed = parseSearchText(
    searchText,
    filter.kind === "type" ? filter.value : "all",
  );
  const { orgPrefix } = parsed;

  // Determine what to show based on filter
  const showScenarios =
    filter.kind !== "type" || filter.value !== "organizations";
  const showOrgs =
    filter.kind === "type" &&
    (filter.value === "all" || filter.value === "organizations");

  // Apply dropdown filter to scenarios
  const filteredScenarios = useMemo(
    () => applyDropdownFilter(scenarios.data, filter),
    [scenarios.data, filter],
  );

  // Split scenarios into pinned, recent, and rest
  const pinnedSet = useMemo(
    () => new Set(pinned.pinnedIds),
    [pinned.pinnedIds],
  );

  const pinnedScenarios = useMemo(
    () =>
      filteredScenarios.filter((item) => pinnedSet.has(scenarioItemKey(item))),
    [filteredScenarios, pinnedSet],
  );

  const recentScenarios = useMemo(() => {
    const recentMap = new Map<string, number>();
    recents.recentIds.forEach((id, index) => recentMap.set(id, index));

    return filteredScenarios
      .filter((item) => {
        const key = scenarioItemKey(item);
        return recentMap.has(key) && !pinnedSet.has(key);
      })
      .sort((a, b) => {
        const aIdx = recentMap.get(scenarioItemKey(a)) ?? Infinity;
        const bIdx = recentMap.get(scenarioItemKey(b)) ?? Infinity;
        return aIdx - bIdx;
      });
  }, [filteredScenarios, recents.recentIds, pinnedSet]);

  const restScenarios = useMemo(() => {
    const recentSet = new Set(recents.recentIds);
    return filteredScenarios.filter((item) => {
      const key = scenarioItemKey(item);
      return !pinnedSet.has(key) && !recentSet.has(key);
    });
  }, [filteredScenarios, pinnedSet, recents.recentIds]);

  // Deduplicate orgs for the dropdown
  const uniqueOrgs = useMemo(() => {
    const seen = new Map<number, Organization>();
    for (const item of scenarios.data) {
      if (!seen.has(item.org.id)) {
        seen.set(item.org.id, item.org);
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [scenarios.data]);

  const filteredOrgs = filterOrgs(orgs.data, parsed);

  function revalidate() {
    orgs.revalidate();
    scenarios.revalidate();
  }

  const allSkipped = [
    ...new Set([...scenarios.skippedOrgs, ...orgs.skippedOrgs]),
  ];

  const hasResults =
    (showScenarios && filteredScenarios.length > 0) ||
    (showOrgs && filteredOrgs.length > 0);

  function renderScenarioItem(item: ScenarioItem) {
    const key = scenarioItemKey(item);
    return (
      <ScenarioListItem
        key={`sc-${key}`}
        item={item}
        isPinned={pinned.isPinned(key)}
        onTogglePin={() => pinned.togglePin(key)}
        onVisit={() => recents.recordVisit(key)}
        onRefresh={revalidate}
      />
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Make.com... (type > for orgs)"
      onSearchTextChange={setSearchText}
      filtering={orgPrefix ? false : { keepSectionOrder: true }}
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
          {uniqueOrgs.length > 1 && (
            <List.Dropdown.Section title="Organization">
              {uniqueOrgs.map((org) => (
                <List.Dropdown.Item
                  key={org.id}
                  title={org.name}
                  value={`org:${org.id}`}
                />
              ))}
            </List.Dropdown.Section>
          )}
        </List.Dropdown>
      }
    >
      {!isLoading && !hasResults && (
        <List.EmptyView
          title="No results found"
          description="Check your API token and zone in extension preferences."
          icon={Icon.MagnifyingGlass}
        />
      )}
      {showScenarios && pinnedScenarios.length > 0 && (
        <List.Section title="Pinned" subtitle={String(pinnedScenarios.length)}>
          {pinnedScenarios.map(renderScenarioItem)}
        </List.Section>
      )}
      {showScenarios && recentScenarios.length > 0 && (
        <List.Section title="Recent" subtitle={String(recentScenarios.length)}>
          {recentScenarios.map(renderScenarioItem)}
        </List.Section>
      )}
      {showScenarios && (
        <List.Section title="Scenarios" subtitle={String(restScenarios.length)}>
          {restScenarios.map(renderScenarioItem)}
        </List.Section>
      )}
      {showOrgs && (
        <List.Section
          title="Organizations"
          subtitle={String(filteredOrgs.length)}
        >
          {filteredOrgs.map((item) => {
            const { org, team } = item;
            const url = buildOrgScenariosUrl(org.zone, team.id);

            return (
              <List.Item
                key={`org-${org.id}-${team.id}`}
                title={org.name}
                subtitle={team.name}
                accessories={[
                  { tag: { value: zoneLabel(org.zone), color: Color.Blue } },
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
                          org={org}
                          scenarios={scenarios.data.filter(
                            (s) => s.org.id === org.id,
                          )}
                          isPinned={pinned.isPinned}
                          onTogglePin={pinned.togglePin}
                          onVisit={recents.recordVisit}
                          onRefresh={revalidate}
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
                      onAction={revalidate}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      )}
      <SkippedOrgsSection names={allSkipped} />
    </List>
  );
}
