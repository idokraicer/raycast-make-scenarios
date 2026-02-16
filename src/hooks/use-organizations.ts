import { LocalStorage, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrganizations, fetchTeams } from "../api/endpoints.js";
import { Organization, Team } from "../api/types.js";
import { createPool } from "../utils/concurrency.js";

const CACHE_KEY = "organizations-cache-v1";

export interface OrgTeamItem {
  org: Organization;
  team: Team;
}

interface CachedOrganizations {
  items: OrgTeamItem[];
  skippedOrgs: string[];
}

async function readCache(): Promise<CachedOrganizations | null> {
  try {
    const raw = await LocalStorage.getItem<string>(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedOrganizations;
  } catch {
    return null;
  }
}

async function writeCache(data: CachedOrganizations): Promise<void> {
  try {
    await LocalStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch {
    // Cache write failure is non-critical
  }
}

export function useOrganizations() {
  const [items, setItems] = useState<OrgTeamItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [skipped, setSkipped] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const fetchFresh = useCallback(
    async (signal: AbortSignal, background: boolean) => {
      const skippedOrgs: string[] = [];

      const orgs = await fetchOrganizations({ signal });
      if (signal.aborted) return;

      if (orgs.length === 0) {
        setItems([]);
        setSkipped([]);
        setIsLoading(false);
        writeCache({ items: [], skippedOrgs: [] });
        return;
      }

      const pool = createPool(6);
      const allBatches: OrgTeamItem[] = [];

      await Promise.allSettled(
        orgs.map(async (org) => {
          try {
            const teams = await pool.run(() =>
              fetchTeams(org.zone, org.id, { signal }),
            );
            if (signal.aborted) return;

            const batch = teams.map((team) => ({ org, team }));
            allBatches.push(...batch);

            if (!background) {
              setItems(
                [...allBatches].sort((a, b) =>
                  a.org.name.localeCompare(b.org.name),
                ),
              );
            }
          } catch {
            skippedOrgs.push(org.name);
          }
        }),
      );

      if (!signal.aborted) {
        const finalItems = [...allBatches].sort((a, b) =>
          a.org.name.localeCompare(b.org.name),
        );
        setItems(finalItems);
        setIsLoading(false);
        setSkipped([...skippedOrgs]);
        writeCache({ items: finalItems, skippedOrgs });
      }
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
          title: "Failed to load organizations",
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
        setItems(cached.items);
        setSkipped(cached.skippedOrgs);
        // Background refresh; loading bar disappears when it completes
        fetchFresh(signal, true).catch(() => {
          setIsLoading(false);
        });
      } else {
        fetchFresh(signal, false).catch((err) => {
          if (!signal.aborted) {
            setIsLoading(false);
            showToast({
              style: Toast.Style.Failure,
              title: "Failed to load organizations",
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
