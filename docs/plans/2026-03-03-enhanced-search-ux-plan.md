# Enhanced Search UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add pinned scenarios, recent history, and enhanced filtering to the main search-make command.

**Architecture:** Three new hooks (`use-pinned.ts`, `use-recents.ts`) plus a utility for scenario key generation. A new filter-parsing module replaces the simple type dropdown. The main `search-make.tsx` view is refactored to render Pinned → Recent → All Scenarios → Organizations → Skipped Orgs sections, with client-side dropdown filtering applied before rendering.

**Tech Stack:** React hooks, `@raycast/api` (List, Action, Keyboard), `@raycast/utils` (useLocalStorage), vitest for tests.

---

### Task 1: Scenario Key Utility

**Files:**
- Create: `src/utils/scenario-key.ts`
- Create: `src/utils/scenario-key.test.ts`

**Step 1: Write the failing test**

```typescript
// src/utils/scenario-key.test.ts
import { describe, it, expect } from "vitest";
import { scenarioKey } from "./scenario-key.js";

describe("scenarioKey", () => {
  it("creates composite key from zone, orgId, and scenarioId", () => {
    expect(scenarioKey("eu1.make.com", 42, 100)).toBe("eu1.make.com-42-100");
  });

  it("handles different zones", () => {
    expect(scenarioKey("us1.make.com", 1, 2)).toBe("us1.make.com-1-2");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun run test -- src/utils/scenario-key.test.ts`
Expected: FAIL — `scenarioKey` is not defined

**Step 3: Write minimal implementation**

```typescript
// src/utils/scenario-key.ts
import { ScenarioItem } from "../api/types.js";

export function scenarioKey(zone: string, orgId: number, scenarioId: number): string {
  return `${zone}-${orgId}-${scenarioId}`;
}

export function scenarioItemKey(item: ScenarioItem): string {
  return scenarioKey(item.org.zone, item.org.id, item.scenario.id);
}
```

**Step 4: Run test to verify it passes**

Run: `bun run test -- src/utils/scenario-key.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/utils/scenario-key.ts src/utils/scenario-key.test.ts
git commit -m "feat: add scenario key utility for pinned/recent lookups"
```

---

### Task 2: Pinned Scenarios Hook

**Files:**
- Create: `src/hooks/use-pinned.ts`

**Step 1: Write the hook**

```typescript
// src/hooks/use-pinned.ts
import { useLocalStorage } from "@raycast/utils";
import { useCallback } from "react";

const STORAGE_KEY = "pinned-scenario-ids";

export function usePinned() {
  const { value: pinnedIds = [], setValue: setPinnedIds, isLoading } =
    useLocalStorage<string[]>(STORAGE_KEY, []);

  const isPinned = useCallback(
    (id: string) => pinnedIds.includes(id),
    [pinnedIds],
  );

  const togglePin = useCallback(
    (id: string) => {
      if (pinnedIds.includes(id)) {
        setPinnedIds(pinnedIds.filter((p) => p !== id));
      } else {
        setPinnedIds([id, ...pinnedIds]);
      }
    },
    [pinnedIds, setPinnedIds],
  );

  return { pinnedIds, isPinned, togglePin, isLoading };
}
```

**Step 2: Verify it compiles**

Run: `bun run build`
Expected: No type errors related to `use-pinned.ts`

**Step 3: Commit**

```bash
git add src/hooks/use-pinned.ts
git commit -m "feat: add usePinned hook for scenario pinning"
```

---

### Task 3: Recent History Hook

**Files:**
- Create: `src/hooks/use-recents.ts`

**Step 1: Write the hook**

```typescript
// src/hooks/use-recents.ts
import { useLocalStorage } from "@raycast/utils";
import { useCallback } from "react";

const STORAGE_KEY = "recent-scenario-ids";
const MAX_RECENTS = 10;

export function useRecents() {
  const { value: recentIds = [], setValue: setRecentIds, isLoading } =
    useLocalStorage<string[]>(STORAGE_KEY, []);

  const recordVisit = useCallback(
    (id: string) => {
      const updated = [id, ...recentIds.filter((r) => r !== id)].slice(0, MAX_RECENTS);
      setRecentIds(updated);
    },
    [recentIds, setRecentIds],
  );

  return { recentIds, recordVisit, isLoading };
}
```

**Step 2: Verify it compiles**

Run: `bun run build`
Expected: No type errors related to `use-recents.ts`

**Step 3: Commit**

```bash
git add src/hooks/use-recents.ts
git commit -m "feat: add useRecents hook for recent scenario history"
```

---

### Task 4: Enhanced Filter Dropdown Logic

**Files:**
- Modify: `src/utils/search-filter.ts`
- Modify: `src/utils/search-filter.test.ts`

This task extends the existing `search-filter.ts` with dropdown filter parsing. The dropdown now emits prefixed values like `type:all`, `status:active`, `org:42`.

**Step 1: Write the failing tests**

Add to `src/utils/search-filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSearchText, filterOrgs, parseDropdownFilter, applyDropdownFilter } from "./search-filter.js";
import type { OrgTeamItem } from "../hooks/use-organizations.js";
import type { ScenarioItem } from "../api/types.js";

// ... keep all existing tests ...

function makeScenarioItem(overrides: {
  name?: string;
  isPaused?: boolean;
  orgId?: number;
  orgName?: string;
  scenarioId?: number;
} = {}): ScenarioItem {
  return {
    scenario: {
      id: overrides.scenarioId ?? 1,
      name: overrides.name ?? "Test Scenario",
      description: "",
      islinked: false,
      isPaused: overrides.isPaused ?? false,
      teamId: 1,
      hookId: null,
      folderId: null,
      lastEdit: "2026-01-01T00:00:00Z",
      updatedByUser: null,
    },
    team: { id: 1, name: "Default", organizationId: overrides.orgId ?? 1 },
    org: { id: overrides.orgId ?? 1, name: overrides.orgName ?? "Acme", zone: "eu1.make.com" },
    folder: null,
    webhookUrl: null,
  };
}

describe("parseDropdownFilter", () => {
  it("parses type:all", () => {
    const result = parseDropdownFilter("type:all");
    expect(result).toEqual({ kind: "type", value: "all" });
  });

  it("parses type:scenarios", () => {
    const result = parseDropdownFilter("type:scenarios");
    expect(result).toEqual({ kind: "type", value: "scenarios" });
  });

  it("parses type:organizations", () => {
    const result = parseDropdownFilter("type:organizations");
    expect(result).toEqual({ kind: "type", value: "organizations" });
  });

  it("parses status:active", () => {
    const result = parseDropdownFilter("status:active");
    expect(result).toEqual({ kind: "status", value: "active" });
  });

  it("parses status:paused", () => {
    const result = parseDropdownFilter("status:paused");
    expect(result).toEqual({ kind: "status", value: "paused" });
  });

  it("parses org:<id>", () => {
    const result = parseDropdownFilter("org:42");
    expect(result).toEqual({ kind: "org", value: 42 });
  });

  it("defaults to type:all for unknown", () => {
    const result = parseDropdownFilter("garbage");
    expect(result).toEqual({ kind: "type", value: "all" });
  });
});

describe("applyDropdownFilter", () => {
  const scenarios: ScenarioItem[] = [
    makeScenarioItem({ scenarioId: 1, name: "Active One", isPaused: false, orgId: 1, orgName: "Acme" }),
    makeScenarioItem({ scenarioId: 2, name: "Paused One", isPaused: true, orgId: 1, orgName: "Acme" }),
    makeScenarioItem({ scenarioId: 3, name: "Active Two", isPaused: false, orgId: 2, orgName: "Beta" }),
  ];

  it("type:all returns all scenarios", () => {
    const result = applyDropdownFilter(scenarios, { kind: "type", value: "all" });
    expect(result).toHaveLength(3);
  });

  it("type:scenarios returns all scenarios (no filtering by type)", () => {
    const result = applyDropdownFilter(scenarios, { kind: "type", value: "scenarios" });
    expect(result).toHaveLength(3);
  });

  it("status:active filters to non-paused", () => {
    const result = applyDropdownFilter(scenarios, { kind: "status", value: "active" });
    expect(result).toHaveLength(2);
    expect(result.every((s) => !s.scenario.isPaused)).toBe(true);
  });

  it("status:paused filters to paused", () => {
    const result = applyDropdownFilter(scenarios, { kind: "status", value: "paused" });
    expect(result).toHaveLength(1);
    expect(result[0].scenario.name).toBe("Paused One");
  });

  it("org:<id> filters to specific org", () => {
    const result = applyDropdownFilter(scenarios, { kind: "org", value: 2 });
    expect(result).toHaveLength(1);
    expect(result[0].org.name).toBe("Beta");
  });

  it("org:<id> with no match returns empty", () => {
    const result = applyDropdownFilter(scenarios, { kind: "org", value: 999 });
    expect(result).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `bun run test -- src/utils/search-filter.test.ts`
Expected: FAIL — `parseDropdownFilter` and `applyDropdownFilter` not exported

**Step 3: Implement the new functions**

Add to `src/utils/search-filter.ts`:

```typescript
import type { OrgTeamItem } from "../hooks/use-organizations.js";
import type { ScenarioItem } from "../api/types.js";

// ... keep existing parseSearchText and filterOrgs unchanged ...

export type DropdownFilter =
  | { kind: "type"; value: "all" | "scenarios" | "organizations" }
  | { kind: "status"; value: "active" | "paused" }
  | { kind: "org"; value: number };

export function parseDropdownFilter(raw: string): DropdownFilter {
  if (raw.startsWith("type:")) {
    const value = raw.slice(5) as "all" | "scenarios" | "organizations";
    if (["all", "scenarios", "organizations"].includes(value)) {
      return { kind: "type", value };
    }
  }
  if (raw.startsWith("status:")) {
    const value = raw.slice(7) as "active" | "paused";
    if (["active", "paused"].includes(value)) {
      return { kind: "status", value };
    }
  }
  if (raw.startsWith("org:")) {
    const id = Number(raw.slice(4));
    if (!isNaN(id)) {
      return { kind: "org", value: id };
    }
  }
  return { kind: "type", value: "all" };
}

export function applyDropdownFilter(
  scenarios: ScenarioItem[],
  filter: DropdownFilter,
): ScenarioItem[] {
  switch (filter.kind) {
    case "type":
      return scenarios;
    case "status":
      return scenarios.filter((s) =>
        filter.value === "active" ? !s.scenario.isPaused : s.scenario.isPaused,
      );
    case "org":
      return scenarios.filter((s) => s.org.id === filter.value);
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `bun run test -- src/utils/search-filter.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/utils/search-filter.ts src/utils/search-filter.test.ts
git commit -m "feat: add dropdown filter parsing for status and org filters"
```

---

### Task 5: Update ScenarioListItem with Pin and Visit Tracking

**Files:**
- Modify: `src/components/scenario-list-item.tsx`

The component receives new props: `isPinned`, `onTogglePin`, `onVisit`.

**Step 1: Update the component**

Replace `src/components/scenario-list-item.tsx` with:

```typescript
import { Action, ActionPanel, Color, Icon, Keyboard, List } from "@raycast/api";
import { ScenarioItem } from "../api/types.js";
import { buildScenarioUrl, zoneLabel } from "../utils/url.js";
import { ScenarioLogsView } from "./scenario-logs-view.js";

export function ScenarioListItem({
  item,
  isPinned,
  onTogglePin,
  onVisit,
  onRefresh,
}: {
  item: ScenarioItem;
  isPinned: boolean;
  onTogglePin: () => void;
  onVisit: () => void;
  onRefresh: () => void;
}) {
  const { scenario, team, org, folder, webhookUrl } = item;
  const url = buildScenarioUrl(org.zone, team.id, scenario.id);
  const isActive = !scenario.isPaused;

  const subtitle = folder ? `${team.name} / ${folder.name}` : team.name;
  const keywords = webhookUrl ? [webhookUrl.split("?")[0]] : undefined;

  return (
    <List.Item
      title={scenario.name}
      subtitle={subtitle}
      keywords={keywords}
      icon={{
        source: isActive ? Icon.CircleFilled : Icon.CircleDisabled,
        tintColor: isActive ? Color.Green : Color.SecondaryText,
      }}
      accessories={[
        ...(isPinned ? [{ icon: { source: Icon.Star, tintColor: Color.Yellow } }] : []),
        { text: org.name },
        { tag: { value: zoneLabel(org.zone), color: Color.Blue } },
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
```

**Key changes:**
- New props: `isPinned`, `onTogglePin`, `onVisit`
- Star accessory icon when pinned
- Pin/Unpin action with `Keyboard.Shortcut.Common.Pin`
- `onOpen` callback on `Action.OpenInBrowser` for visit tracking
- `onPush` callback on `Action.Push` for visit tracking

**Step 2: Verify it compiles (will have type errors in consumers — that's expected)**

Run: `bun run build`
Expected: Type errors in `search-make.tsx` and `org-scenarios-view.tsx` because they don't pass the new required props yet. This is expected and will be fixed in Task 6.

**Step 3: Commit**

```bash
git add src/components/scenario-list-item.tsx
git commit -m "feat: add pin/unpin and visit tracking to ScenarioListItem"
```

---

### Task 6: Wire Everything Together in search-make.tsx

**Files:**
- Modify: `src/search-make.tsx`

This is the main integration task. Replace the entire file.

**Step 1: Rewrite `src/search-make.tsx`**

```typescript
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
  DropdownFilter,
} from "./utils/search-filter.js";
import { Organization, ScenarioItem } from "./api/types.js";

export default function SearchMake() {
  const orgs = useOrganizations();
  const scenarios = useScenarios();
  const pinned = usePinned();
  const recents = useRecents();
  const [dropdownValue, setDropdownValue] = useState("type:all");
  const [searchText, setSearchText] = useState("");

  const isLoading = orgs.isLoading || scenarios.isLoading || pinned.isLoading || recents.isLoading;

  const filter = parseDropdownFilter(dropdownValue);
  const parsed = parseSearchText(
    searchText,
    filter.kind === "type" ? filter.value : "all",
  );
  const { orgPrefix } = parsed;

  // Determine what to show based on filter
  const showScenarios = filter.kind !== "type" || filter.value !== "organizations";
  const showOrgs = filter.kind === "type" && (filter.value === "all" || filter.value === "organizations");

  // Apply dropdown filter to scenarios
  const filteredScenarios = useMemo(
    () => applyDropdownFilter(scenarios.data, filter),
    [scenarios.data, filter],
  );

  // Split scenarios into pinned, recent, and rest
  const pinnedSet = useMemo(() => new Set(pinned.pinnedIds), [pinned.pinnedIds]);

  const pinnedScenarios = useMemo(
    () => filteredScenarios.filter((item) => pinnedSet.has(scenarioItemKey(item))),
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
        <List.Dropdown
          tooltip="Filter"
          onChange={setDropdownValue}
          storeValue
        >
          <List.Dropdown.Section title="Type">
            <List.Dropdown.Item title="All" value="type:all" />
            <List.Dropdown.Item title="Scenarios" value="type:scenarios" />
            <List.Dropdown.Item title="Organizations" value="type:organizations" />
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
        <List.Section
          title="Pinned"
          subtitle={String(pinnedScenarios.length)}
        >
          {pinnedScenarios.map(renderScenarioItem)}
        </List.Section>
      )}
      {showScenarios && recentScenarios.length > 0 && (
        <List.Section
          title="Recent"
          subtitle={String(recentScenarios.length)}
        >
          {recentScenarios.map(renderScenarioItem)}
        </List.Section>
      )}
      {showScenarios && (
        <List.Section
          title="Scenarios"
          subtitle={String(restScenarios.length)}
        >
          {restScenarios.map(renderScenarioItem)}
        </List.Section>
      )}
      {showOrgs && (
        <List.Section title="Organizations" subtitle={String(filteredOrgs.length)}>
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
```

**Step 2: Update `org-scenarios-view.tsx` to pass new required props**

The `OrgScenariosView` component uses `ScenarioListItem` too. It needs the new props. Since this is a drill-down view, we pass stub behavior (no pinning/recents in the sub-view — keep it simple).

Actually, looking at the design, pinning and recents should work in the org drill-down too for consistency. Pass the hooks through from the parent, or lift them. Simpler approach: accept callbacks as props.

Modify `src/components/org-scenarios-view.tsx`:

```typescript
import { Icon, List } from "@raycast/api";
import { useMemo, useState } from "react";
import { Organization, ScenarioItem, Team } from "../api/types.js";
import { ScenarioListItem } from "./scenario-list-item.js";
import { scenarioItemKey } from "../utils/scenario-key.js";

export function OrgScenariosView({
  org,
  scenarios,
  isPinned,
  onTogglePin,
  onVisit,
  onRefresh,
}: {
  org: Organization;
  scenarios: ScenarioItem[];
  isPinned: (key: string) => boolean;
  onTogglePin: (key: string) => void;
  onVisit: (key: string) => void;
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
      {filtered.map((item) => {
        const key = scenarioItemKey(item);
        return (
          <ScenarioListItem
            key={`${item.org.zone}-${item.team.id}-${item.scenario.id}`}
            item={item}
            isPinned={isPinned(key)}
            onTogglePin={() => onTogglePin(key)}
            onVisit={() => onVisit(key)}
            onRefresh={onRefresh}
          />
        );
      })}
    </List>
  );
}
```

Then update the `OrgScenariosView` usage in `search-make.tsx` (already done above in the main rewrite — the `target` prop needs updating):

In the `search-make.tsx` org list item's `Action.Push`, update the target:

```tsx
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
```

**Step 3: Build and verify no type errors**

Run: `bun run build`
Expected: PASS — no type errors

**Step 4: Run all tests**

Run: `bun run test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/search-make.tsx src/components/org-scenarios-view.tsx
git commit -m "feat: wire pinned, recents, and enhanced filtering into search view"
```

---

### Task 7: Update search-scenarios.tsx (secondary command)

**Files:**
- Modify: `src/search-scenarios.tsx`

The `search-scenarios` command also uses `ScenarioListItem`. It needs the new required props. Keep it simple — pass through pin/recent hooks here too.

**Step 1: Read and update `src/search-scenarios.tsx`**

Add the same hook imports and pass `isPinned`, `onTogglePin`, `onVisit` to each `ScenarioListItem`.

**Step 2: Build and verify**

Run: `bun run build`
Expected: PASS

**Step 3: Run all tests**

Run: `bun run test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/search-scenarios.tsx
git commit -m "feat: add pin/recent support to search-scenarios command"
```

---

### Task 8: Manual QA and Lint

**Step 1: Run linter**

Run: `bun run lint`
Expected: No errors

**Step 2: Fix any lint issues**

Run: `bun run fix-lint` if needed

**Step 3: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

**Step 4: Manual testing checklist**

Run: `bun run dev`

Test in Raycast:
- [ ] Open "Search Make" — scenarios load with Pinned/Recent/Scenarios sections
- [ ] Pin a scenario (Cmd+Shift+P) — it appears in Pinned section
- [ ] Unpin it — it moves back to Scenarios section
- [ ] Open a scenario — it appears in Recent section on next search
- [ ] Open 11 scenarios — only last 10 show in Recent
- [ ] Pinned scenarios don't appear in Recent section
- [ ] Filter dropdown shows Type, Status, and Organization sections
- [ ] "Active Only" filter hides paused scenarios
- [ ] "Paused Only" filter shows only paused scenarios
- [ ] Org filter shows only that org's scenarios
- [ ] `>` prefix still works for org search
- [ ] Search text filtering works within each section
- [ ] Section order stays: Pinned → Recent → Scenarios → Organizations
- [ ] Drill into org → pin/recent works there too
- [ ] Filter persists across command launches (storeValue)

**Step 5: Final commit if any fixes**

```bash
git add -A
git commit -m "fix: lint and QA fixes for enhanced search UX"
```
