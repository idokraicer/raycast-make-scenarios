import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { memo } from "react";
import { ScenarioRow } from "../catalog/types.js";
import { buildScenarioUrl, zoneLabel } from "../utils/url.js";
import { ScenarioLogsView } from "./scenario-logs-view.js";

export const ScenarioListItem = memo(function ScenarioListItem({
  item,
  isPinned,
  onTogglePin,
  onVisit,
  onRefresh,
}: {
  item: ScenarioRow;
  isPinned: boolean;
  onTogglePin: () => void;
  onVisit: () => void;
  onRefresh: () => void;
}) {
  const url = buildScenarioUrl(item.zone, item.teamId, item.scenarioId);
  const isActive = !item.isPaused;
  const subtitle = item.folderName
    ? `${item.teamName} / ${item.folderName}`
    : item.teamName;
  const keywords = item.webhookUrl
    ? [item.webhookUrl.split("?")[0]]
    : undefined;

  return (
    <List.Item
      title={item.scenarioName}
      subtitle={subtitle}
      keywords={keywords}
      icon={{
        source: isActive ? Icon.CircleFilled : Icon.CircleDisabled,
        tintColor: isActive ? Color.Green : Color.SecondaryText,
      }}
      accessories={[
        ...(isPinned
          ? [{ icon: { source: Icon.Star, tintColor: Color.Yellow } }]
          : []),
        { text: item.orgName },
        { tag: { value: zoneLabel(item.zone), color: Color.Blue } },
      ]}
      actions={
        <ActionPanel>
          <Action.OpenInBrowser
            title="Open in Make.com"
            url={url}
            onOpen={() => onVisit()}
          />
          <Action.Push
            title="View Execution Logs"
            icon={Icon.Clock}
            shortcut={{ key: "tab", modifiers: [] }}
            target={<ScenarioLogsView item={item} onRefresh={onRefresh} />}
            onPush={() => onVisit()}
          />
          <Action
            title={isPinned ? "Unpin Scenario" : "Pin Scenario"}
            icon={isPinned ? Icon.StarDisabled : Icon.Star}
            shortcut={Keyboard.Shortcut.Common.Pin}
            onAction={onTogglePin}
          />
          <Action.CopyToClipboard
            title="Copy URL"
            content={url}
            shortcut={{ modifiers: ["cmd"], key: "c" }}
          />
          {item.webhookUrl && (
            <Action.CopyToClipboard
              title="Copy Webhook URL"
              content={item.webhookUrl}
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
});
