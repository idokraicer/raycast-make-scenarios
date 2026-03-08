import { getHotStartManifest } from "../catalog/cache.js";
import { listOrganizations, PAGE_SIZE } from "../catalog/service.js";
import {
  OrganizationListRow,
  OrganizationQueryParams,
  PagedResult,
} from "../catalog/types.js";
import { usePagedCatalogQuery } from "./use-paged-catalog-query.js";

function matchesCachedOrganizationQuery(
  row: OrganizationListRow,
  query: string,
): boolean {
  return (
    row.orgName.toLowerCase().includes(query) ||
    row.teamName.toLowerCase().includes(query)
  );
}

function getInitialOrganizationResult(
  params: OrganizationQueryParams,
): PagedResult<OrganizationListRow> | undefined {
  const manifest = getHotStartManifest();
  if (!manifest) {
    return undefined;
  }

  const query = params.query?.trim().toLowerCase() ?? "";
  const filteredRows = query
    ? manifest.organizationRows.filter((row) =>
        matchesCachedOrganizationQuery(row, query),
      )
    : manifest.organizationRows;

  return {
    rows: filteredRows.slice(0, PAGE_SIZE),
    hasMore: filteredRows.length > PAGE_SIZE,
    totalCount: filteredRows.length,
  };
}

export function useOrganizationList(
  params: OrganizationQueryParams = {},
  options: { enabled?: boolean } = {},
) {
  const initialResult = getInitialOrganizationResult(params);

  return usePagedCatalogQuery({
    params,
    enabled: options.enabled,
    initialResult,
    query: listOrganizations,
  });
}
