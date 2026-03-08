import { useEffect, useState } from "react";
import {
  getCatalogSyncStatus,
  subscribeCatalogSyncStatus,
} from "../catalog/cache.js";
import { ensureCatalogReady } from "../catalog/service.js";

export function useCatalogSyncStatus(autoStart = true) {
  const [status, setStatus] = useState(getCatalogSyncStatus());

  useEffect(() => subscribeCatalogSyncStatus(setStatus), []);

  useEffect(() => {
    if (!autoStart) return;
    void ensureCatalogReady();
  }, [autoStart]);

  return {
    ...status,
    isRunning: status.status === "running",
    hasError: status.status === "error",
  };
}
