import { getHotStartManifest } from "../catalog/cache.js";
import { getScenarioRowsByKeys, searchScenarios } from "../catalog/service.js";
import { ScenarioRow, ScenarioSearchParams } from "../catalog/types.js";
import { usePagedCatalogQuery } from "./use-paged-catalog-query.js";

interface QueryOptions {
  enabled?: boolean;
}

function useScenarioRowsByKeys(
  keys: string[],
  params: Omit<
    ScenarioSearchParams,
    "includeKeys" | "excludeKeys" | "limit" | "offset"
  >,
  initialRows: ScenarioRow[],
) {
  return usePagedCatalogQuery({
    params: {
      keys,
      ...params,
    },
    enabled: keys.length > 0,
    initialRows,
    query: ({
      keys: innerKeys,
      ...rest
    }: {
      keys: string[];
    } & Omit<
      ScenarioSearchParams,
      "includeKeys" | "excludeKeys" | "limit" | "offset"
    > & { limit: number; offset: number }) =>
      rest.offset > 0
        ? Promise.resolve({ rows: [], hasMore: false, totalCount: 0 })
        : getScenarioRowsByKeys(innerKeys, rest).then((rows) => ({
            rows,
            hasMore: false,
            totalCount: rows.length,
          })),
  });
}

export function useCatalogSearch(
  params: ScenarioSearchParams,
  options: QueryOptions = {},
) {
  const manifest = getHotStartManifest();
  const initialRows =
    !params.query &&
    !params.orgKey &&
    !params.teamKey &&
    (!params.status || params.status === "all") &&
    (!params.excludeKeys || params.excludeKeys.length === 0)
      ? (manifest?.defaultScenarioRows ?? [])
      : [];

  return usePagedCatalogQuery({
    params,
    enabled: options.enabled,
    initialRows,
    query: searchScenarios,
  });
}

export function usePinnedScenarioRows(
  keys: string[],
  params: Omit<
    ScenarioSearchParams,
    "includeKeys" | "excludeKeys" | "limit" | "offset"
  >,
  options: QueryOptions = {},
) {
  const manifest = getHotStartManifest();
  const initialRows =
    !params.query && (!params.status || params.status === "all")
      ? (manifest?.pinnedRows ?? [])
      : [];

  return useScenarioRowsByKeys(
    options.enabled === false ? [] : keys,
    params,
    initialRows,
  );
}

export function useRecentScenarioRows(
  keys: string[],
  params: Omit<
    ScenarioSearchParams,
    "includeKeys" | "excludeKeys" | "limit" | "offset"
  >,
  options: QueryOptions = {},
) {
  const manifest = getHotStartManifest();
  const initialRows =
    !params.query && (!params.status || params.status === "all")
      ? (manifest?.recentRows ?? [])
      : [];

  return useScenarioRowsByKeys(
    options.enabled === false ? [] : keys,
    params,
    initialRows,
  );
}
