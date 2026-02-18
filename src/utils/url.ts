import { Zone } from "../api/types.js";

export function buildScenarioUrl(
  zone: Zone,
  teamId: number,
  scenarioId: number,
): string {
  return `https://${zone}/${teamId}/scenarios/${scenarioId}/edit`;
}

export function buildOrgScenariosUrl(zone: Zone, teamId: number): string {
  return `https://${zone}/${teamId}/scenarios?folder=all&tab=all&type=scenario&sort=lastEdited`;
}

export function buildScenarioLogUrl(
  zone: Zone,
  teamId: number,
  scenarioId: number,
  imtId: string,
): string {
  // imtId format: "1771412118264_scenario.4169724.manual.aa4f039ec694448fadb10f1db2b30d17"
  // URL needs just the execution hash at the end
  const executionId = imtId.split(".").pop() ?? imtId;
  return `https://${zone}/${teamId}/scenarios/${scenarioId}/logs/${executionId}`;
}

/** Extracts short zone label, e.g. "eu1.make.com" → "eu1" */
export function zoneLabel(zone: Zone): string {
  return zone.split(".")[0];
}
