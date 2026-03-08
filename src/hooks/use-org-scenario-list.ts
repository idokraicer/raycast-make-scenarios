import { listOrgScenarios } from "../catalog/service.js";
import { OrganizationScenarioQueryParams } from "../catalog/types.js";
import { usePagedCatalogQuery } from "./use-paged-catalog-query.js";

export function useOrgScenarioList(
  params: OrganizationScenarioQueryParams,
  options: { enabled?: boolean } = {},
) {
  return usePagedCatalogQuery({
    params,
    enabled: options.enabled,
    initialRows: [],
    query: listOrgScenarios,
  });
}
