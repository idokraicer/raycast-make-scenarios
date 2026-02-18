import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { fetchScenarioLogs, fetchUsers } from "../api/endpoints.js";
import { ScenarioItem, ScenarioLog } from "../api/types.js";
import {
  formatBytes,
  formatDuration,
  formatTimestamp,
} from "../utils/format.js";
import { buildScenarioLogUrl, buildScenarioUrl } from "../utils/url.js";

type LogFilter = "all" | "executions" | "edits" | "1" | "2" | "3";

function isExecution(log: ScenarioLog): boolean {
  return log.status === 1 || log.status === 2 || log.status === 3;
}

function typeLabel(type: string): string {
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function ScenarioLogsView({
  item,
  onRefresh,
}: {
  item: ScenarioItem;
  onRefresh: () => void;
}) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const { scenario, team, org } = item;
  const url = buildScenarioUrl(org.zone, team.id, scenario.id);

  const {
    data: logs,
    isLoading: logsLoading,
    revalidate,
  } = useCachedPromise(
    (zone, scenarioId) => fetchScenarioLogs(zone, scenarioId),
    [org.zone, scenario.id],
  );

  const { data: users, isLoading: usersLoading } = useCachedPromise(
    (zone, teamId) => fetchUsers(zone, teamId),
    [org.zone, team.id],
  );

  const userMap = useMemo(() => {
    const map = new Map<number, string>();
    if (users) {
      for (const u of users) {
        map.set(u.id, u.name);
      }
    }
    return map;
  }, [users]);

  const allLogs = logs ?? [];
  const filteredLogs = allLogs.filter((log) => {
    switch (filter) {
      case "all":
        return true;
      case "executions":
        return isExecution(log);
      case "edits":
        return !isExecution(log);
      default:
        return log.status === Number(filter);
    }
  });

  const isLoading = logsLoading || usersLoading;

  return (
    <List
      isLoading={isLoading}
      navigationTitle={scenario.name}
      searchBarPlaceholder="Filter logs..."
      searchBarAccessory={
        <List.Dropdown
          tooltip="Filter"
          onChange={(v) => setFilter(v as LogFilter)}
        >
          <List.Dropdown.Item title="All" value="all" />
          <List.Dropdown.Item title="Executions" value="executions" />
          <List.Dropdown.Item title="Edits" value="edits" />
          <List.Dropdown.Section title="By Status">
            <List.Dropdown.Item title="Success" value="1" />
            <List.Dropdown.Item title="Warning" value="2" />
            <List.Dropdown.Item title="Error" value="3" />
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      <List.EmptyView
        title={isLoading ? "Loading..." : "No Logs"}
        description={
          filter !== "all"
            ? "Try changing the filter"
            : "This scenario hasn't been executed yet"
        }
      />
      {filteredLogs.map((log) => {
        const authorName = userMap.get(log.authorId);
        const logUrl = buildScenarioLogUrl(
          org.zone,
          team.id,
          scenario.id,
          log.imtId,
        );

        if (isExecution(log)) {
          const accessories: List.Item.Accessory[] = [];
          if (log.operations > 0) {
            accessories.push({ text: `${log.operations} ops` });
          }
          if (log.centicredits > 0) {
            accessories.push({
              text: `${(log.centicredits / 100).toLocaleString()} cr`,
            });
          }
          if (log.transfer > 0) {
            accessories.push({ text: formatBytes(log.transfer) });
          }
          const statusMap: Record<number, { value: string; color: Color }> = {
            1: { value: "Success", color: Color.Green },
            2: { value: "Warning", color: Color.Yellow },
            3: { value: "Error", color: Color.Red },
          };
          accessories.push({ tag: statusMap[log.status] });

          const iconMap: Record<number, { source: Icon; tintColor: Color }> = {
            1: { source: Icon.CheckCircle, tintColor: Color.Green },
            2: { source: Icon.ExclamationMark, tintColor: Color.Yellow },
            3: { source: Icon.XMarkCircle, tintColor: Color.Red },
          };

          return (
            <List.Item
              key={log.imtId}
              icon={iconMap[log.status]}
              title={formatTimestamp(log.timestamp)}
              subtitle={
                log.duration > 0 ? formatDuration(log.duration) : undefined
              }
              accessories={accessories}
              actions={
                <ActionPanel>
                  <Action.OpenInBrowser
                    title="Open Log in Make.com"
                    url={logUrl}
                  />
                  <Action.OpenInBrowser
                    title="Open Scenario in Make.com"
                    url={url}
                    shortcut={{ modifiers: ["cmd"], key: "o" }}
                  />
                  <Action
                    title="Refresh Logs"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => {
                      revalidate();
                      onRefresh();
                    }}
                  />
                </ActionPanel>
              }
            />
          );
        }

        // Non-execution entry (edit, save, etc.)
        const accessories: List.Item.Accessory[] = [];
        accessories.push({
          tag: { value: typeLabel(log.type), color: Color.Blue },
        });

        return (
          <List.Item
            key={log.imtId}
            icon={{ source: Icon.Pencil, tintColor: Color.Blue }}
            title={formatTimestamp(log.timestamp)}
            subtitle={authorName}
            accessories={accessories}
            actions={
              <ActionPanel>
                <Action.OpenInBrowser
                  title="Open Log in Make.com"
                  url={logUrl}
                />
                <Action.OpenInBrowser
                  title="Open Scenario in Make.com"
                  url={url}
                  shortcut={{ modifiers: ["cmd"], key: "o" }}
                />
                <Action
                  title="Refresh Logs"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={() => {
                    revalidate();
                    onRefresh();
                  }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
