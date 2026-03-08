import { useEffect, useState } from "react";
import { getHotStartManifest } from "../catalog/cache.js";
import {
  getSkippedOrganizations,
  subscribeCatalogVersion,
} from "../catalog/service.js";

export function useSkippedOrganizations() {
  const [names, setNames] = useState<string[]>(
    getHotStartManifest()?.skippedOrgs ?? [],
  );

  useEffect(() => {
    setNames(getSkippedOrganizations());
    return subscribeCatalogVersion(() => {
      setNames(getSkippedOrganizations());
    });
  }, []);

  return names;
}
