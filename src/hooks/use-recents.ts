import { useLocalStorage } from "@raycast/utils";
import { useCallback, useMemo } from "react";

const STORAGE_KEY = "recent-scenario-ids";
const MAX_RECENTS = 10;

export function useRecents() {
  const {
    value: recentIds = [],
    setValue: setRecentIds,
    isLoading,
  } = useLocalStorage<string[]>(STORAGE_KEY, []);
  const uniqueRecentIds = useMemo(() => [...new Set(recentIds)], [recentIds]);

  const recordVisit = useCallback(
    (id: string) => {
      const updated = [id, ...uniqueRecentIds.filter((r) => r !== id)].slice(
        0,
        MAX_RECENTS,
      );
      setRecentIds(updated);
    },
    [setRecentIds, uniqueRecentIds],
  );

  return { recentIds: uniqueRecentIds, recordVisit, isLoading };
}
