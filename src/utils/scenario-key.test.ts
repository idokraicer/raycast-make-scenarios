import { describe, it, expect } from "vitest";
import { organizationKey, scenarioKey, teamKey } from "./scenario-key.js";

describe("organizationKey", () => {
  it("creates composite key from zone and orgId", () => {
    expect(organizationKey("eu1.make.com", 42)).toBe("eu1.make.com-42");
  });
});

describe("teamKey", () => {
  it("creates composite key from zone and teamId", () => {
    expect(teamKey("eu1.make.com", 9)).toBe("eu1.make.com-9");
  });
});

describe("scenarioKey", () => {
  it("creates composite key from zone, orgId, teamId, and scenarioId", () => {
    expect(scenarioKey("eu1.make.com", 42, 9, 100)).toBe(
      "eu1.make.com-42-9-100",
    );
  });

  it("handles different zones", () => {
    expect(scenarioKey("us1.make.com", 1, 8, 2)).toBe("us1.make.com-1-8-2");
  });

  it("differentiates scenarios with the same scenario id across teams", () => {
    expect(scenarioKey("eu1.make.com", 42, 9, 100)).not.toBe(
      scenarioKey("eu1.make.com", 42, 10, 100),
    );
  });
});
