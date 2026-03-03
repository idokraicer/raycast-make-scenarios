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
