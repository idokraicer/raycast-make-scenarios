import { getPreferenceValues } from "@raycast/api";
import { Zone } from "./types.js";

function getAuthHeader(): string {
  const { apiToken } = getPreferenceValues<{ apiToken: string }>();
  const token = apiToken.trim();
  if (!token) {
    throw new Error("API token is empty. Set it in extension preferences.");
  }
  // Handle both "Token xxx" and bare "xxx" input
  if (token.toLowerCase().startsWith("token ")) {
    return token;
  }
  return `Token ${token}`;
}

function baseUrl(zone: Zone): string {
  return `https://${zone}/api/v2`;
}

export interface FetchOptions {
  zone: Zone;
  path: string;
  params?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const MAX_PAGES = 50;
const DEFAULT_TIMEOUT_MS = 30_000;

function createTimeoutSignal(timeoutMs: number, signal?: AbortSignal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const abortFromParent = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener("abort", abortFromParent);
      }
    },
  };
}

export async function apiFetch<T>(options: FetchOptions): Promise<T> {
  const {
    zone,
    path,
    params,
    signal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;
  const url = new URL(`${baseUrl(zone)}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const timeout = createTimeoutSignal(timeoutMs, signal);
  let response: Response;

  try {
    response = await fetch(url.toString(), {
      headers: {
        Authorization: getAuthHeader(),
        "Content-Type": "application/json",
      },
      signal: timeout.signal,
    });
  } catch (error) {
    timeout.cleanup();

    if (timeout.signal.aborted) {
      throw new Error(
        `Request timed out after ${timeoutMs}ms (${zone}${path})`,
      );
    }

    throw error;
  }

  timeout.cleanup();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `Authentication failed on ${zone}. Check your API token.`,
      );
    }
    throw new Error(
      `API error ${response.status}: ${response.statusText} (${zone}${path})`,
    );
  }

  return response.json() as Promise<T>;
}

export async function apiFetchAllPages<T>(
  options: FetchOptions,
  key: string,
): Promise<T[]> {
  const allItems: T[] = [];
  for await (const page of apiFetchAllPagesIterator<T>(options, key)) {
    allItems.push(...page);
  }

  return allItems;
}

export async function* apiFetchAllPagesIterator<T>(
  options: FetchOptions,
  key: string,
): AsyncGenerator<T[], void, void> {
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = {
      ...options.params,
      "pg[offset]": String(offset),
      "pg[limit]": String(limit),
    };
    const data = await apiFetch<Record<string, unknown>>({
      ...options,
      params,
    });
    const items = data[key];
    if (!Array.isArray(items)) break;
    const typedItems = items as T[];
    yield typedItems;

    if (items.length < limit) break;
    offset += limit;
  }
}
