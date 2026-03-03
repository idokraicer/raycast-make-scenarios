import type { OrgTeamItem } from "../hooks/use-organizations.js";
import type { ScenarioItem } from "../api/types.js";

export interface SearchParseResult {
  /** Whether the ">" prefix was detected */
  orgPrefix: boolean;
  /** The effective filter to apply */
  effectiveFilter: "all" | "scenarios" | "organizations";
  /** Lowercase org search query (empty string if no prefix) */
  orgSearchQuery: string;
}

export function parseSearchText(
  searchText: string,
  dropdownFilter: "all" | "scenarios" | "organizations",
): SearchParseResult {
  const orgPrefix = searchText.startsWith(">");
  return {
    orgPrefix,
    effectiveFilter: orgPrefix ? "organizations" : dropdownFilter,
    orgSearchQuery: orgPrefix ? searchText.slice(1).trim().toLowerCase() : "",
  };
}

export function filterOrgs(
  orgs: OrgTeamItem[],
  parsed: SearchParseResult,
): OrgTeamItem[] {
  if (!parsed.orgPrefix) return orgs;
  if (parsed.orgSearchQuery === "") return orgs;
  return orgs.filter((item) =>
    item.org.name.toLowerCase().includes(parsed.orgSearchQuery),
  );
}

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
