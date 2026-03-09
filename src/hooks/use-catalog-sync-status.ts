import { useEffect, useState } from "react";
import {
  getCatalogSyncStatus,
  subscribeCatalogSyncStatus,
} from "../catalog/cache.js";
import { ensureCatalogReady } from "../catalog/service.js";

const SYNC_RUNNING_STALE_MS = 2 * 60 * 1000;

interface CatalogSyncViewState {
  isRunning: boolean;
  hasError: boolean;
}

function toViewState(status = getCatalogSyncStatus()): CatalogSyncViewState {
  return {
    isRunning:
      status.status === "running" &&
      Date.now() - status.updatedAt <= SYNC_RUNNING_STALE_MS,
    hasError: status.status === "error",
  };
}

function mergeViewState(
  previous: CatalogSyncViewState,
  next: CatalogSyncViewState,
): CatalogSyncViewState {
  if (
    previous.isRunning === next.isRunning &&
    previous.hasError === next.hasError
  ) {
    return previous;
  }

  return next;
}

export function useCatalogSyncStatus(autoStart = true) {
  const [viewState, setViewState] = useState<CatalogSyncViewState>(toViewState);

  useEffect(
    () =>
      subscribeCatalogSyncStatus((status) => {
        setViewState((previous) =>
          mergeViewState(previous, toViewState(status)),
        );
      }),
    [],
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setViewState((previous) => mergeViewState(previous, toViewState()));
    }, 500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!autoStart) return;
    void ensureCatalogReady();
  }, [autoStart]);

  return viewState;
}
