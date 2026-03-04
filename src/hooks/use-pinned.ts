import { useLocalStorage } from "@raycast/utils";
import { useCallback } from "react";

const STORAGE_KEY = "pinned-scenario-ids";

export function usePinned() {
  const {
    value: pinnedIds = [],
    setValue: setPinnedIds,
    isLoading,
  } = useLocalStorage<string[]>(STORAGE_KEY, []);

  const isPinned = useCallback(
    (id: string) => pinnedIds.includes(id),
    [pinnedIds],
  );

  const togglePin = useCallback(
    (id: string) => {
      if (pinnedIds.includes(id)) {
        setPinnedIds(pinnedIds.filter((p) => p !== id));
      } else {
        setPinnedIds([id, ...pinnedIds]);
      }
    },
    [pinnedIds, setPinnedIds],
  );

  return { pinnedIds, isPinned, togglePin, isLoading };
}
