import type { OrganizationListRow, ScenarioRow } from "../catalog/types.js";

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
  orgs: OrganizationListRow[],
  parsed: SearchParseResult,
): OrganizationListRow[] {
  if (!parsed.orgPrefix) return orgs;
  if (parsed.orgSearchQuery === "") return orgs;
  return orgs.filter((item) =>
    item.orgName.toLowerCase().includes(parsed.orgSearchQuery),
  );
}

export type DropdownFilter =
  | { kind: "type"; value: "all" | "scenarios" | "organizations" }
  | { kind: "status"; value: "active" | "paused" }
  | { kind: "org"; value: string };

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
    const orgKey = raw.slice(4);
    if (orgKey) {
      return { kind: "org", value: orgKey };
    }
  }
  return { kind: "type", value: "all" };
}

export function applyDropdownFilter(
  scenarios: ScenarioRow[],
  filter: DropdownFilter,
): ScenarioRow[] {
  switch (filter.kind) {
    case "type":
      return scenarios;
    case "status":
      return scenarios.filter((s) =>
        filter.value === "active" ? !s.isPaused : s.isPaused,
      );
    case "org":
      return scenarios.filter((s) => s.orgKey === filter.value);
  }
}
