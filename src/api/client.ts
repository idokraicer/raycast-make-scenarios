import { getPreferenceValues } from "@raycast/api";
import { Zone } from "./types.js";

function getAuthHeader(): string {
  const { apiToken } = getPreferenceValues<{ apiToken: string }>();
  const token = apiToken.trim();
  // Handle both "Token xxx" and bare "xxx" input
  if (token.toLowerCase().startsWith("token ")) {
    return token;
  }
  return `Token ${token}`;
}

function baseUrl(zone: Zone): string {
  return `https://${zone}/api/v2`;
}

interface FetchOptions {
  zone: Zone;
  path: string;
  params?: Record<string, string>;
}

export async function apiFetch<T>(options: FetchOptions): Promise<T> {
  const { zone, path, params } = options;
  const url = new URL(`${baseUrl(zone)}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
    },
  });

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
  let offset = 0;
  const limit = 100;

  while (true) {
    const params = {
      ...options.params,
      "pg[offset]": String(offset),
      "pg[limit]": String(limit),
    };
    const data = await apiFetch<Record<string, T[]>>({ ...options, params });
    const items = data[key] ?? [];
    allItems.push(...items);

    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}
