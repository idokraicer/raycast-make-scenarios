# Enhanced Search UX Design

## Problem

With hundreds of scenarios across many organizations, finding the right scenario is slow. Users repeatedly access the same scenarios but have no way to pin or quickly access them. Filtering is limited to type (Scenarios / Organizations) with no status or org-level filtering.

## Solution

Enhance the main `search-make` command with three features:

1. **Pinned Scenarios** — star/unstar scenarios to keep them at the top
2. **Recent History** — auto-track recently opened scenarios
3. **Enhanced Filtering** — merged dropdown with type, status, and org filters

## Design

### 1. Pinned Scenarios

- Store pinned IDs in `LocalStorage` via `useLocalStorage<string[]>` from `@raycast/utils`
- Composite key per scenario: `${zone}-${orgId}-${scenarioId}`
- Pin/Unpin action in `ScenarioListItem` using `Keyboard.Shortcut.Common.Pin` (Cmd+Shift+P)
- "Pinned" `List.Section` renders at the top of the search view
- Use `filtering={{ keepSectionOrder: true }}` so pinned items stay on top during search

### 2. Recent History

- Store last 10 recently opened scenario IDs in `LocalStorage` via `useLocalStorage<string[]>`
- Track visits on "Open in Make.com" and "View Execution Logs" actions
- Deduplicate: revisiting a scenario moves it to the front
- Pinned scenarios excluded from the Recent section
- "Recent" `List.Section` renders between Pinned and All Scenarios

### 3. Enhanced Filtering

**Constraint:** Raycast supports only one `searchBarAccessory` dropdown.

**Solution:** Merge all filters into a single sectioned dropdown:

- **Type section:** All, Scenarios, Organizations
- **Status section:** Active only, Paused only
- **Organization section:** Dynamic list of all loaded orgs

Dropdown values use prefixes: `type:all`, `type:scenarios`, `status:active`, `status:paused`, `org:<id>`

`storeValue={true}` persists the last selection across launches.

### Section Ordering

1. **Pinned** (if any, filtered by dropdown)
2. **Recent** (if any, excluding pinned, filtered by dropdown)
3. **Scenarios** (all remaining, filtered by dropdown)
4. **Organizations** (when type includes orgs)
5. **Skipped Orgs** (unchanged)

### Filtering Behavior

- Raycast built-in `filtering={{ keepSectionOrder: true }}` handles text search
- Dropdown filters applied client-side before rendering (filter data arrays)
- Text search and dropdown filters work orthogonally
- Existing `>` prefix for org search continues to work

## New Files

- `src/hooks/use-pinned.ts` — `useLocalStorage<string[]>` for pinned scenario IDs, toggle helper
- `src/hooks/use-recents.ts` — `useLocalStorage<string[]>` for recent scenario IDs, record-visit helper

## Modified Files

- `src/search-make.tsx` — new sections, enhanced dropdown, filtering logic
- `src/components/scenario-list-item.tsx` — pin/unpin action, visit tracking callback

## API Details

- `useLocalStorage<string[]>(key, defaultValue)` from `@raycast/utils` — handles JSON serialization, provides `value` and `setValue`
- `Keyboard.Shortcut.Common.Pin` — standard Raycast pin shortcut
- `List.Dropdown.Section` — groups dropdown items visually
- `filtering={{ keepSectionOrder: true }}` — preserves section order during search
