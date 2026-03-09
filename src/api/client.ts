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

export class ApiError extends Error {
  status: number;
  statusText: string;
  zone: Zone;
  path: string;

  constructor(
    message: string,
    {
      status,
      statusText,
      zone,
      path,
    }: { status: number; statusText: string; zone: Zone; path: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.zone = zone;
    this.path = path;
  }
}

export function isApiErrorWithStatus(
  error: unknown,
  status: number,
): error is ApiError {
  return error instanceof ApiError && error.status === status;
}

const MAX_PAGES = 50;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RATE_LIMIT_RETRIES = 4;
const BASE_RATE_LIMIT_DELAY_MS = 1_000;
const MAX_RATE_LIMIT_DELAY_MS = 8_000;

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

function parseRetryAfterMs(value: string | null): number | null {
  if (!value) {
    return null;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - Date.now());
}

function getRateLimitDelayMs(response: Response, attempt: number): number {
  return Math.min(
    parseRetryAfterMs(response.headers.get("Retry-After")) ??
      BASE_RATE_LIMIT_DELAY_MS * 2 ** attempt,
    MAX_RATE_LIMIT_DELAY_MS,
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("Request aborted"));
    }

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
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

      if (signal?.aborted) {
        throw new Error(`Request aborted (${zone}${path})`);
      }

      if (timeout.signal.aborted) {
        throw new Error(
          `Request timed out after ${timeoutMs}ms (${zone}${path})`,
        );
      }

      throw error;
    }

    timeout.cleanup();

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await delay(getRateLimitDelayMs(response, attempt), signal);
      continue;
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError(
          `Authentication failed on ${zone}. Check your API token.`,
          {
            status: response.status,
            statusText: response.statusText,
            zone,
            path,
          },
        );
      }

      if (response.status === 403) {
        throw new ApiError(
          `Forbidden on ${zone}${path}. The token does not have access to this resource.`,
          {
            status: response.status,
            statusText: response.statusText,
            zone,
            path,
          },
        );
      }

      if (response.status === 429) {
        throw new ApiError(
          `API rate limit exceeded after ${MAX_RATE_LIMIT_RETRIES + 1} attempts (${zone}${path})`,
          {
            status: response.status,
            statusText: response.statusText,
            zone,
            path,
          },
        );
      }

      throw new ApiError(
        `API error ${response.status}: ${response.statusText} (${zone}${path})`,
        {
          status: response.status,
          statusText: response.statusText,
          zone,
          path,
        },
      );
    }

    return response.json() as Promise<T>;
  }

  throw new Error(`Unexpected API retry state (${zone}${path})`);
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
