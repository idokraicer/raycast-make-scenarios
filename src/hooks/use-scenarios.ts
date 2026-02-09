import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchCurrentUserId,
  fetchOrganizations,
  fetchTeams,
  fetchScenarios,
  fetchFolders,
  fetchHooks,
} from "../api/endpoints.js";
import { Folder, Hook, ScenarioItem } from "../api/types.js";

function sortItems(items: ScenarioItem[], myUserId: number): ScenarioItem[] {
  return [...items].sort((a, b) => {
    const aIsMine = a.scenario.updatedByUser?.id === myUserId ? 0 : 1;
    const bIsMine = b.scenario.updatedByUser?.id === myUserId ? 0 : 1;
    if (aIsMine !== bIsMine) return aIsMine - bIsMine;
    return (
      new Date(b.scenario.lastEdit).getTime() -
      new Date(a.scenario.lastEdit).getTime()
    );
  });
}

export function useScenarios() {
  const [items, setItems] = useState<ScenarioItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsLoading(true);
    setItems([]);

    try {
      const [myUserId, orgs] = await Promise.all([
        fetchCurrentUserId(),
        fetchOrganizations(),
      ]);
      if (abort.signal.aborted) return;

      let pending = orgs.length;

      await Promise.allSettled(
        orgs.map(async (org) => {
          try {
            const teams = await fetchTeams(org.zone, org.id);
            if (abort.signal.aborted) return;

            const teamResults = await Promise.allSettled(
              teams.map(async (team) => {
                const [scenarios, folders, hooks] = await Promise.all([
                  fetchScenarios(org.zone, team.id),
                  fetchFolders(org.zone, team.id),
                  fetchHooks(org.zone, team.id),
                ]);

                const folderMap = new Map<number, Folder>();
                for (const folder of folders) {
                  folderMap.set(folder.id, folder);
                }

                const hookMap = new Map<number, Hook>();
                for (const hook of hooks) {
                  if (hook.url) {
                    hookMap.set(hook.id, hook);
                  }
                }

                return scenarios.map(
                  (scenario): ScenarioItem => ({
                    scenario,
                    team,
                    org,
                    folder: scenario.folderId
                      ? (folderMap.get(scenario.folderId) ?? null)
                      : null,
                    webhookUrl: scenario.hookId
                      ? (hookMap.get(scenario.hookId)?.url ?? null)
                      : null,
                  }),
                );
              }),
            );

            if (abort.signal.aborted) return;

            const batch = teamResults
              .filter(
                (r): r is PromiseFulfilledResult<ScenarioItem[]> =>
                  r.status === "fulfilled",
              )
              .flatMap((r) => r.value);

            if (batch.length > 0) {
              setItems((prev) => sortItems([...prev, ...batch], myUserId));
            }
          } finally {
            pending--;
            if (pending === 0 && !abort.signal.aborted) {
              setIsLoading(false);
            }
          }
        }),
      );
    } catch {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { data: items, isLoading, revalidate: load };
}
