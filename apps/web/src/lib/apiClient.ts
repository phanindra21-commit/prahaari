export const API_BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function rawRequest(path: string, token: string | null, options: RequestOptions): Promise<Response> {
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

/**
 * Typed fetch wrapper: injects the bearer token from authStore, and on a
 * 401 attempts exactly one refresh-and-retry (the proactive timer in
 * authStore.ts covers the common case; this is the fallback for a token
 * that expired while this tab was inactive). A second 401 after that
 * retry is a genuine session loss — the caller sees it as a thrown
 * ApiError and the app-level query error boundary sends the user to
 * /login rather than looping.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Imported lazily to avoid a circular import (authStore imports API_BASE_URL from this module).
  const { useAuthStore, refreshSession } = await import("../stores/authStore");

  let token = useAuthStore.getState().accessToken;
  let res = await rawRequest(path, token, options);

  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      token = useAuthStore.getState().accessToken;
      res = await rawRequest(path, token, options);
    }
  }

  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Response had no JSON body — keep the generic message.
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
