import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCatalogVersion } from "../catalog/cache.js";
import { PAGE_SIZE, subscribeCatalogVersion } from "../catalog/service.js";
import { PagedResult } from "../catalog/types.js";

interface UsePagedCatalogQueryOptions<T, P extends object> {
  params: P;
  enabled?: boolean;
  initialRows?: T[];
  query: (
    params: P & { limit: number; offset: number },
  ) => Promise<PagedResult<T>>;
}

export function usePagedCatalogQuery<T, P extends object>({
  params,
  enabled = true,
  initialRows = [],
  query,
}: UsePagedCatalogQueryOptions<T, P>) {
  const initialRowsSignature = useMemo(
    () => JSON.stringify(initialRows),
    [initialRows],
  );
  const stableInitialRows = useMemo(() => initialRows, [initialRowsSignature]);

  const [rows, setRows] = useState<T[]>(stableInitialRows);
  const [hasMore, setHasMore] = useState(stableInitialRows.length >= PAGE_SIZE);
  const [totalCount, setTotalCount] = useState(stableInitialRows.length);
  const [isLoading, setIsLoading] = useState(
    enabled && stableInitialRows.length === 0,
  );
  const [page, setPage] = useState(1);
  const [catalogVersion, setCatalogVersion] = useState(getCatalogVersion());
  const requestIdRef = useRef(0);
  const queryRef = useRef(query);

  const signature = useMemo(() => JSON.stringify(params), [params]);
  const stableParams = useMemo(() => JSON.parse(signature) as P, [signature]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => subscribeCatalogVersion(setCatalogVersion), []);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setHasMore(false);
      setTotalCount(0);
      setIsLoading(false);
      setPage(1);
      return;
    }

    setRows(stableInitialRows);
    setHasMore(stableInitialRows.length >= PAGE_SIZE);
    setTotalCount(stableInitialRows.length);
    setPage(1);
  }, [enabled, initialRowsSignature, signature, stableInitialRows]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);

    void queryRef
      .current({
        ...stableParams,
        limit: PAGE_SIZE,
        offset: 0,
      })
      .then((result) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setRows(result.rows);
        setHasMore(result.hasMore);
        setTotalCount(result.totalCount);
        setPage(1);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }, [catalogVersion, enabled, signature, stableParams]);

  const loadMore = useCallback(() => {
    if (!enabled || isLoading || !hasMore) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);

    void queryRef
      .current({
        ...stableParams,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then((result) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        setRows((previousRows) => [...previousRows, ...result.rows]);
        setHasMore(result.hasMore);
        setTotalCount(result.totalCount);
        setPage((value) => value + 1);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setIsLoading(false);
        }
      });
  }, [enabled, hasMore, isLoading, page, stableParams]);

  return {
    rows,
    hasMore,
    totalCount,
    isLoading,
    loadMore,
    pageSize: PAGE_SIZE,
  };
}
