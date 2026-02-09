import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useOrganizations } from "./hooks/use-organizations.js";
import { buildOrgScenariosUrl, zoneLabel } from "./utils/url.js";

export default function SearchOrganizations() {
  const { data: items, isLoading, revalidate } = useOrganizations();

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search organizations...">
      {items.map((item) => {
        const { org, team } = item;
        const url = buildOrgScenariosUrl(org.zone, team.id);

        return (
          <List.Item
            key={`${org.id}-${team.id}`}
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
    </List>
  );
}
