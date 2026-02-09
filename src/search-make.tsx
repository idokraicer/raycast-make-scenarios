import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useState } from "react";
import { useOrganizations } from "./hooks/use-organizations.js";
import { useScenarios } from "./hooks/use-scenarios.js";
import { ScenarioItem } from "./api/types.js";
import {
  buildOrgScenariosUrl,
  buildScenarioUrl,
  zoneLabel,
} from "./utils/url.js";

type Filter = "all" | "scenarios" | "organizations";

export default function SearchMake() {
  const orgs = useOrganizations();
  const scenarios = useScenarios();
  const [filter, setFilter] = useState<Filter>("all");

  const isLoading = orgs.isLoading || scenarios.isLoading;

  function revalidate() {
    orgs.revalidate();
    scenarios.revalidate();
  }

  const showScenarios = filter === "all" || filter === "scenarios";
  const showOrgs = filter === "all" || filter === "organizations";

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search Make.com..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter type"
          onChange={(v) => setFilter(v as Filter)}
        >
          <List.Dropdown.Item title="All" value="all" />
          <List.Dropdown.Item title="Scenarios" value="scenarios" />
          <List.Dropdown.Item title="Organizations" value="organizations" />
        </List.Dropdown>
      }
    >
      {showScenarios && (
        <List.Section
          title="Scenarios"
          subtitle={String(scenarios.data.length)}
        >
          {scenarios.data.map((item) => (
            <ScenarioListItem
              key={`sc-${item.org.zone}-${item.scenario.id}`}
              item={item}
              onRefresh={revalidate}
            />
          ))}
        </List.Section>
      )}
      {showOrgs && (
        <List.Section
          title="Organizations"
          subtitle={String(orgs.data.length)}
        >
          {orgs.data.map((item) => {
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
