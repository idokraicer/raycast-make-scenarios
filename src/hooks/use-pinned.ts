import { useLocalStorage } from "@raycast/utils";
import { useCallback, useMemo } from "react";

const STORAGE_KEY = "pinned-scenario-ids";

export function usePinned() {
  const {
    value: pinnedIds = [],
    setValue: setPinnedIds,
    isLoading,
  } = useLocalStorage<string[]>(STORAGE_KEY, []);
  const uniquePinnedIds = useMemo(() => [...new Set(pinnedIds)], [pinnedIds]);

  const isPinned = useCallback(
    (id: string) => uniquePinnedIds.includes(id),
    [uniquePinnedIds],
  );

  const togglePin = useCallback(
    (id: string) => {
      if (uniquePinnedIds.includes(id)) {
        setPinnedIds(uniquePinnedIds.filter((p) => p !== id));
      } else {
        setPinnedIds([id, ...uniquePinnedIds]);
      }
    },
    [setPinnedIds, uniquePinnedIds],
  );

  return { pinnedIds: uniquePinnedIds, isPinned, togglePin, isLoading };
}
