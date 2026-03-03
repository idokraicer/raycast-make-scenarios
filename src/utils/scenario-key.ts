import { ScenarioItem } from "../api/types.js";

export function scenarioKey(zone: string, orgId: number, scenarioId: number): string {
  return `${zone}-${orgId}-${scenarioId}`;
}

export function scenarioItemKey(item: ScenarioItem): string {
  return scenarioKey(item.org.zone, item.org.id, item.scenario.id);
}
