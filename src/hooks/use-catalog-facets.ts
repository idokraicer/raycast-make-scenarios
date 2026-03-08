import { useEffect, useState } from "react";
import { getHotStartManifest } from "../catalog/cache.js";
import { getFacets, subscribeCatalogVersion } from "../catalog/service.js";
import { CatalogFacets } from "../catalog/types.js";

const EMPTY_FACETS: CatalogFacets = {
  organizations: [],
  teamsByOrg: {},
};

export function useCatalogFacets() {
  const [facets, setFacets] = useState<CatalogFacets>(
    getHotStartManifest()?.facets ?? EMPTY_FACETS,
  );

  useEffect(() => {
    setFacets(getFacets());
    return subscribeCatalogVersion(() => {
      setFacets(getFacets());
    });
  }, []);

  return facets;
}
