import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useState } from "react";
import { useScenarios } from "./hooks/use-scenarios.js";
import { ScenarioItem } from "./api/types.js";
import { buildScenarioUrl, zoneLabel } from "./utils/url.js";

export default function SearchScenarios() {
  const { data: items, isLoading, revalidate } = useScenarios();
  const [filter, setFilter] = useState<string>("all");

  const orgs = uniqueBy(items ?? [], (i) => i.org.id).map((i) => i.org);
  const teams = uniqueBy(items ?? [], (i) => i.team.id).map((i) => i.team);

  const filtered = filterItems(items ?? [], filter);

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search scenarios..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter by Organization / Team"
          onChange={setFilter}
        >
          <List.Dropdown.Item title="All" value="all" />
          {orgs.map((org) => (
            <List.Dropdown.Section key={org.id} title={org.name}>
              <List.Dropdown.Item
                title={`All in ${org.name}`}
                value={`org:${org.id}`}
              />
              {teams
                .filter((t) => t.organizationId === org.id)
                .map((team) => (
                  <List.Dropdown.Item
                    key={team.id}
                    title={team.name}
                    value={`team:${team.id}`}
                  />
                ))}
            </List.Dropdown.Section>
          ))}
        </List.Dropdown>
      }
    >
      {filtered.map((item) => (
        <ScenarioListItem
          key={`${item.org.zone}-${item.org.id}-${item.team.id}-${item.scenario.id}`}
          item={item}
          onRefresh={revalidate}
        />
      ))}
    </List>
  );
}

function ScenarioListItem({
  item,
  onRefresh,
}: {
  item: ScenarioItem;
  onRefresh: () => void;
}) {
  const { scenario, team, org, folder, webhookUrl } = item;
  const url = buildScenarioUrl(org.zone, team.id, scenario.id);
  const isActive = !scenario.isPaused;

  const subtitle = folder ? `${team.name} / ${folder.name}` : team.name;

  return (
    <List.Item
      title={scenario.name}
      subtitle={subtitle}
      icon={{
        source: isActive ? Icon.CircleFilled : Icon.CircleDisabled,
        tintColor: isActive ? Color.Green : Color.SecondaryText,
      }}
      accessories={[
        { text: org.name },
        { tag: { value: zoneLabel(org.zone), color: Color.Blue } },
      ]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser title="Open in Make.com" url={url} />
          <Action.CopyToClipboard
            title="Copy URL"
            content={url}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          {webhookUrl && (
            <Action.CopyToClipboard
              title="Copy Webhook URL"
              content={webhookUrl}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
          )}
          <Action
            title="Refresh"
            icon={Icon.ArrowClockwise}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={onRefresh}
          />
        </ActionPanel>
      }
    />
  );
}

function filterItems(items: ScenarioItem[], filter: string): ScenarioItem[] {
  if (filter === "all") return items;

  if (filter.startsWith("org:")) {
    const orgId = Number(filter.slice(4));
    return items.filter((i) => i.org.id === orgId);
  }

  if (filter.startsWith("team:")) {
    const teamId = Number(filter.slice(5));
    return items.filter((i) => i.team.id === teamId);
  }

  return items;
}

function uniqueBy<T>(arr: T[], keyFn: (item: T) => number): T[] {
  const seen = new Set<number>();
  return arr.filter((item) => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
