import { getHotStartManifest } from "../catalog/cache.js";
import { listOrganizations } from "../catalog/service.js";
import { OrganizationQueryParams } from "../catalog/types.js";
import { usePagedCatalogQuery } from "./use-paged-catalog-query.js";

export function useOrganizationList(
  params: OrganizationQueryParams = {},
  options: { enabled?: boolean } = {},
) {
  const manifest = getHotStartManifest();
  const initialRows = !params.query ? (manifest?.organizationRows ?? []) : [];

  return usePagedCatalogQuery({
    params,
    enabled: options.enabled,
    initialRows,
    query: listOrganizations,
  });
}
