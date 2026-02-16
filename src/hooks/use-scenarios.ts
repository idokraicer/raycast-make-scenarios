import { LocalStorage, showToast, Toast } from "@raycast/api";
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
import { createPool } from "../utils/concurrency.js";

const CACHE_KEY = "scenarios-cache-v1";

let cachedUserId: number | null = null;

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

function deduplicateItems(items: ScenarioItem[]): ScenarioItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.org.zone}-${item.org.id}-${item.scenario.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

interface CachedScenarios {
  items: ScenarioItem[];
  skippedOrgs: string[];
  userId: number;
}

async function readCache(): Promise<CachedScenarios | null> {
  try {
    const raw = await LocalStorage.getItem<string>(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedScenarios;
  } catch {
    return null;
  }
}

async function writeCache(data: CachedScenarios): Promise<void> {
  try {
    await LocalStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Cache write failure is non-critical
  }
}

export function useScenarios() {
  const [items, setItems] = useState<ScenarioItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [skipped, setSkipped] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFresh = useCallback(
    async (signal: AbortSignal, background: boolean) => {
      const skippedOrgs: string[] = [];
      const freshItems: ScenarioItem[] = [];

      const myUserId = cachedUserId ?? (await fetchCurrentUserId({ signal }));
      cachedUserId = myUserId;

      const orgs = await fetchOrganizations({ signal });
      if (signal.aborted) return;

      if (orgs.length === 0) {
        setItems([]);
        setSkipped([]);
        setIsLoading(false);
        writeCache({ items: [], skippedOrgs: [], userId: myUserId });
        return;
      }

      const pool = createPool(6);
      let completedOrgs = 0;

      await Promise.allSettled(
        orgs.map(async (org) => {
          try {
            const teams = await pool.run(() =>
              fetchTeams(org.zone, org.id, { signal }),
            );
            if (signal.aborted) return;

            const teamResults = await Promise.allSettled(
              teams.map((team) =>
                pool.run(async () => {
                  const [scenarios, folders, hooks] = await Promise.all([
                    fetchScenarios(org.zone, team.id, { signal }),
                    fetchFolders(org.zone, team.id, { signal }),
                    fetchHooks(org.zone, team.id, { signal }),
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
              ),
            );

            if (signal.aborted) return;

            const batch = teamResults
              .filter(
                (r): r is PromiseFulfilledResult<ScenarioItem[]> =>
                  r.status === "fulfilled",
              )
              .flatMap((r) => r.value);

            if (batch.length > 0) {
              freshItems.push(...batch);
              if (!background) {
                setItems(
                  sortItems(deduplicateItems([...freshItems]), myUserId),
                );
              }
            }
          } catch {
            skippedOrgs.push(org.name);
          } finally {
            completedOrgs++;
            if (completedOrgs === orgs.length && !signal.aborted) {
              const finalItems = sortItems(
                deduplicateItems(freshItems),
                myUserId,
              );
              setItems(finalItems);
              setIsLoading(false);
              setSkipped([...skippedOrgs]);
              writeCache({ items: finalItems, skippedOrgs, userId: myUserId });
            }
          }
        }),
      );
    },
    [],
  );

  // Hard refresh: clears state, shows spinner, progressive load
  const load = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    const signal = abort.signal;

    setIsLoading(true);
    setItems([]);
    setSkipped([]);

    try {
      await fetchFresh(signal, false);
    } catch (err) {
      if (!signal.aborted) {
        setIsLoading(false);
        showToast({
          style: Toast.Style.Failure,
          title: "Failed to load scenarios",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }, [fetchFresh]);

  // Initial mount: try cache first, then background refresh
  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    const signal = abort.signal;

    readCache().then((cached) => {
      if (signal.aborted) return;

      if (cached) {
        // Show cached data instantly — keep isLoading=true so the
        // loading bar stays visible while background refresh runs
        cachedUserId = cached.userId;
        setItems(cached.items);
        setSkipped(cached.skippedOrgs);
        // Background refresh; loading bar disappears when it completes
        fetchFresh(signal, true).catch(() => {
          // Background refresh failed — show cached data, hide loading bar
          setIsLoading(false);
        });
      } else {
        // No cache — normal progressive load with spinner
        fetchFresh(signal, false).catch((err) => {
          if (!signal.aborted) {
            setIsLoading(false);
            showToast({
              style: Toast.Style.Failure,
              title: "Failed to load scenarios",
              message: err instanceof Error ? err.message : String(err),
            });
          }
        });
      }
    });

    return () => abort.abort();
  }, [fetchFresh]);

  return { data: items, isLoading, skippedOrgs: skipped, revalidate: load };
}
