import { useLocalStorage } from "@raycast/utils";
import { useCallback } from "react";

const STORAGE_KEY = "recent-scenario-ids";
const MAX_RECENTS = 10;

export function useRecents() {
  const {
    value: recentIds = [],
    setValue: setRecentIds,
    isLoading,
  } = useLocalStorage<string[]>(STORAGE_KEY, []);

  const recordVisit = useCallback(
    (id: string) => {
      const updated = [id, ...recentIds.filter((r) => r !== id)].slice(
        0,
        MAX_RECENTS,
      );
      setRecentIds(updated);
    },
    [recentIds, setRecentIds],
  );

  return { recentIds, recordVisit, isLoading };
}
