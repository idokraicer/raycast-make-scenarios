import { describe, it, expect } from "vitest";
import { parseSearchText, filterOrgs, parseDropdownFilter, applyDropdownFilter } from "./search-filter.js";
import type { OrgTeamItem } from "../hooks/use-organizations.js";
import type { ScenarioItem } from "../api/types.js";

function makeOrg(name: string, id = 1): OrgTeamItem {
  return {
    org: { id, name, zone: "eu1.make.com" },
    team: { id: 1, name: "Default", organizationId: id },
  };
}

describe("parseSearchText", () => {
  it("returns no prefix for normal text", () => {
    const result = parseSearchText("hello", "all");
    expect(result.orgPrefix).toBe(false);
    expect(result.effectiveFilter).toBe("all");
    expect(result.orgSearchQuery).toBe("");
  });

  it("preserves dropdown filter when no prefix", () => {
    expect(parseSearchText("test", "scenarios").effectiveFilter).toBe("scenarios");
    expect(parseSearchText("test", "organizations").effectiveFilter).toBe("organizations");
  });

  it("detects > prefix and overrides filter to organizations", () => {
    const result = parseSearchText(">acme", "all");
    expect(result.orgPrefix).toBe(true);
    expect(result.effectiveFilter).toBe("organizations");
    expect(result.orgSearchQuery).toBe("acme");
  });

  it("overrides even when dropdown is set to scenarios", () => {
    const result = parseSearchText(">test", "scenarios");
    expect(result.effectiveFilter).toBe("organizations");
  });

  it("trims whitespace after >", () => {
    const result = parseSearchText(">  acme  ", "all");
    expect(result.orgSearchQuery).toBe("acme");
  });

  it("lowercases the query", () => {
    const result = parseSearchText(">ACME Corp", "all");
    expect(result.orgSearchQuery).toBe("acme corp");
  });

  it("handles > with no text after it", () => {
    const result = parseSearchText(">", "all");
    expect(result.orgPrefix).toBe(true);
    expect(result.effectiveFilter).toBe("organizations");
    expect(result.orgSearchQuery).toBe("");
  });

  it("handles > with only whitespace", () => {
    const result = parseSearchText(">   ", "all");
    expect(result.orgPrefix).toBe(true);
    expect(result.orgSearchQuery).toBe("");
  });

  it("does not treat > in the middle as prefix", () => {
    const result = parseSearchText("a>b", "all");
    expect(result.orgPrefix).toBe(false);
    expect(result.effectiveFilter).toBe("all");
  });

  it("handles empty search text", () => {
    const result = parseSearchText("", "all");
    expect(result.orgPrefix).toBe(false);
    expect(result.orgSearchQuery).toBe("");
  });
});

describe("filterOrgs", () => {
  const orgs: OrgTeamItem[] = [
    makeOrg("Acme Corp", 1),
    makeOrg("Beta Inc", 2),
    makeOrg("Acme Labs", 3),
  ];

  it("returns all orgs when no prefix", () => {
    const parsed = parseSearchText("acme", "all");
    expect(filterOrgs(orgs, parsed)).toEqual(orgs);
  });

  it("filters orgs by name with > prefix", () => {
    const parsed = parseSearchText(">acme", "all");
    const result = filterOrgs(orgs, parsed);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.org.name)).toEqual(["Acme Corp", "Acme Labs"]);
  });

  it("is case-insensitive", () => {
    const parsed = parseSearchText(">BETA", "all");
    const result = filterOrgs(orgs, parsed);
    expect(result).toHaveLength(1);
    expect(result[0].org.name).toBe("Beta Inc");
  });

  it("returns all orgs when > with no query", () => {
    const parsed = parseSearchText(">", "all");
    expect(filterOrgs(orgs, parsed)).toEqual(orgs);
  });

  it("returns empty array when no match", () => {
    const parsed = parseSearchText(">zzz", "all");
    expect(filterOrgs(orgs, parsed)).toEqual([]);
  });

  it("handles empty orgs array", () => {
    const parsed = parseSearchText(">acme", "all");
    expect(filterOrgs([], parsed)).toEqual([]);
  });

  it("matches partial org names", () => {
    const parsed = parseSearchText(">corp", "all");
    const result = filterOrgs(orgs, parsed);
    expect(result).toHaveLength(1);
    expect(result[0].org.name).toBe("Acme Corp");
  });
});

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
