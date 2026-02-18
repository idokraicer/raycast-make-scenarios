import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useOrganizations } from "./hooks/use-organizations.js";
import { useScenarios } from "./hooks/use-scenarios.js";
import { OrgScenariosView } from "./components/org-scenarios-view.js";
import { SkippedOrgsSection } from "./components/skipped-orgs-section.js";
import { buildOrgScenariosUrl, zoneLabel } from "./utils/url.js";

export default function SearchOrganizations() {
  const orgs = useOrganizations();
  const scenarios = useScenarios();

  const isLoading = orgs.isLoading || scenarios.isLoading;

  function revalidate() {
    orgs.revalidate();
    scenarios.revalidate();
  }

  const allSkipped = [
    ...new Set([...orgs.skippedOrgs, ...scenarios.skippedOrgs]),
  ];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search organizations...">
      {!isLoading && orgs.data.length === 0 && (
        <List.EmptyView
          title="No organizations found"
          description="Check your API token and zone in extension preferences."
          icon={Icon.MagnifyingGlass}
        />
      )}
      {orgs.data.map((item) => {
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
      <SkippedOrgsSection names={allSkipped} />
    </List>
  );
}
