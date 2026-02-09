import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOrganizations, fetchTeams } from "../api/endpoints.js";
import { Organization, Team } from "../api/types.js";

export interface OrgTeamItem {
  org: Organization;
  team: Team;
}

export function useOrganizations() {
  const [items, setItems] = useState<OrgTeamItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsLoading(true);
    setItems([]);

    try {
      const orgs = await fetchOrganizations();
      if (abort.signal.aborted) return;

      await Promise.allSettled(
        orgs.map(async (org) => {
          try {
            const teams = await fetchTeams(org.zone, org.id);
            if (abort.signal.aborted) return;

            const batch = teams.map((team) => ({ org, team }));
            if (batch.length > 0) {
              setItems((prev) =>
                [...prev, ...batch].sort((a, b) =>
                  a.org.name.localeCompare(b.org.name),
                ),
              );
            }
          } catch {
            // skip orgs that fail
          }
        }),
      );
    } finally {
      if (!abort.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { data: items, isLoading, revalidate: load };
}
