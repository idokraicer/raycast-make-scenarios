import { ScenarioRow } from "../catalog/types.js";

export function organizationKey(zone: string, orgId: number): string {
  return `${zone}-${orgId}`;
}

export function teamKey(zone: string, teamId: number): string {
  return `${zone}-${teamId}`;
}

export function scenarioKey(
  zone: string,
  orgId: number,
  teamId: number,
  scenarioId: number,
): string {
  return `${zone}-${orgId}-${teamId}-${scenarioId}`;
}

export function scenarioRowKey(item: ScenarioRow): string {
  return item.key;
}
