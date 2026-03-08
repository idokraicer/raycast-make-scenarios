import { describe, expect, it } from "vitest";
import type { OrganizationListRow, ScenarioRow } from "../catalog/types.js";
import { organizationKey, teamKey } from "./scenario-key.js";
import {
  applyDropdownFilter,
  filterOrgs,
  parseDropdownFilter,
  parseSearchText,
} from "./search-filter.js";

function makeOrg(name: string, id = 1): OrganizationListRow {
  return {
    orgKey: organizationKey("eu1.make.com", id),
    orgId: id,
    orgName: name,
    zone: "eu1.make.com",
    teamKey: teamKey("eu1.make.com", id),
    teamId: id,
    teamName: "Default",
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
    expect(parseSearchText("test", "scenarios").effectiveFilter).toBe(
      "scenarios",
    );
    expect(parseSearchText("test", "organizations").effectiveFilter).toBe(
      "organizations",
    );
  });

  it("detects > prefix and overrides filter to organizations", () => {
    const result = parseSearchText(">acme", "all");
    expect(result.orgPrefix).toBe(true);
    expect(result.effectiveFilter).toBe("organizations");
    expect(result.orgSearchQuery).toBe("acme");
  });

  it("trims whitespace after >", () => {
    const result = parseSearchText(">  acme  ", "all");
    expect(result.orgSearchQuery).toBe("acme");
  });

  it("lowercases the query", () => {
    const result = parseSearchText(">ACME Corp", "all");
    expect(result.orgSearchQuery).toBe("acme corp");
  });
});

describe("filterOrgs", () => {
  const orgs: OrganizationListRow[] = [
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
    expect(result.map((org) => org.orgName)).toEqual([
      "Acme Corp",
      "Acme Labs",
    ]);
  });

  it("is case-insensitive", () => {
    const parsed = parseSearchText(">BETA", "all");
    const result = filterOrgs(orgs, parsed);
    expect(result).toHaveLength(1);
    expect(result[0].orgName).toBe("Beta Inc");
  });

  it("returns all orgs when > with no query", () => {
    const parsed = parseSearchText(">", "all");
    expect(filterOrgs(orgs, parsed)).toEqual(orgs);
  });
});

function makeScenarioRow(overrides: Partial<ScenarioRow> = {}): ScenarioRow {
  const orgId = overrides.orgId ?? 1;
  const zone = overrides.zone ?? "eu1.make.com";
  const teamId = overrides.teamId ?? 1;
  const scenarioId = overrides.scenarioId ?? 1;
  return {
    key: overrides.key ?? `${zone}-${orgId}-${teamId}-${scenarioId}`,
    scenarioId,
    scenarioName: overrides.scenarioName ?? "Test Scenario",
    orgKey: overrides.orgKey ?? organizationKey(zone, orgId),
    orgId,
    orgName: overrides.orgName ?? "Acme",
    zone,
    teamKey: overrides.teamKey ?? teamKey(zone, teamId),
    teamId,
    teamName: overrides.teamName ?? "Default",
    folderId: overrides.folderId ?? null,
    folderName: overrides.folderName ?? null,
    hookId: overrides.hookId ?? null,
    webhookUrl: overrides.webhookUrl ?? null,
    metadataState: overrides.metadataState ?? "ready",
    isPaused: overrides.isPaused ?? false,
    lastEditTs: overrides.lastEditTs ?? Date.parse("2026-01-01T00:00:00Z"),
    updatedByUserId: overrides.updatedByUserId ?? null,
  };
}

describe("parseDropdownFilter", () => {
  it("parses type:all", () => {
    expect(parseDropdownFilter("type:all")).toEqual({
      kind: "type",
      value: "all",
    });
  });

  it("parses status:active", () => {
    expect(parseDropdownFilter("status:active")).toEqual({
      kind: "status",
      value: "active",
    });
  });

  it("parses org:<key>", () => {
    expect(parseDropdownFilter("org:eu1.make.com-42")).toEqual({
      kind: "org",
      value: "eu1.make.com-42",
    });
  });

  it("defaults to type:all for unknown", () => {
    expect(parseDropdownFilter("garbage")).toEqual({
      kind: "type",
      value: "all",
    });
  });
});

describe("applyDropdownFilter", () => {
  const scenarios: ScenarioRow[] = [
    makeScenarioRow({
      scenarioId: 1,
      scenarioName: "Active One",
      isPaused: false,
      orgId: 1,
      orgName: "Acme",
    }),
    makeScenarioRow({
      scenarioId: 2,
      scenarioName: "Paused One",
      isPaused: true,
      orgId: 1,
      orgName: "Acme",
    }),
    makeScenarioRow({
      scenarioId: 3,
      scenarioName: "Active Two",
      isPaused: false,
      orgId: 2,
      orgName: "Beta",
    }),
  ];

  it("type:all returns all scenarios", () => {
    expect(
      applyDropdownFilter(scenarios, { kind: "type", value: "all" }),
    ).toHaveLength(3);
  });

  it("status:active filters to non-paused", () => {
    const result = applyDropdownFilter(scenarios, {
      kind: "status",
      value: "active",
    });
    expect(result).toHaveLength(2);
    expect(result.every((scenario) => !scenario.isPaused)).toBe(true);
  });

  it("status:paused filters to paused", () => {
    const result = applyDropdownFilter(scenarios, {
      kind: "status",
      value: "paused",
    });
    expect(result).toHaveLength(1);
    expect(result[0].scenarioName).toBe("Paused One");
  });

  it("org:<key> filters to specific org", () => {
    const result = applyDropdownFilter(scenarios, {
      kind: "org",
      value: organizationKey("eu1.make.com", 2),
    });
    expect(result).toHaveLength(1);
    expect(result[0].orgName).toBe("Beta");
  });
});
