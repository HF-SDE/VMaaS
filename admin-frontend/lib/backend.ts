import "server-only"

import { cookies } from "next/headers"

import { config } from "./config"

type CookieLike = { name: string; value: string }

/** Better Auth's cookies, including the __Secure-/__Host- prefixed production variants. */
const AUTH_COOKIE = /^(?:__Secure-|__Host-)?better-auth\./

/**
 * Narrows a cookie jar to the auth cookies alone. The backend only needs those,
 * and forwarding the rest would hand it unrelated first-party cookies.
 */
export function authCookieHeader(cookies: CookieLike[]): string {
  return cookies
    .filter(({ name }) => AUTH_COOKIE.test(name))
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ")
}

export class BackendError extends Error {
  constructor(
    readonly status: number,
    path: string
  ) {
    super(`Backend request failed: ${status} ${path}`)
    this.name = "BackendError"
  }
}

type BackendRequestOptions = Omit<RequestInit, "body" | "cache"> & {
  cookieHeader: string
  /** Sent as X-Tenant-Id. Must come from a lib/dal.ts gate, never from user input. */
  tenantId?: string
  json?: unknown
}

/**
 * Pure over its input so it is unit-testable: the caller supplies the cookie
 * header. Use `backendFetch` from a server component or action instead.
 */
export async function backendRequest<T>(
  path: string,
  { cookieHeader, tenantId, json, headers, ...init }: BackendRequestOptions
): Promise<T> {
  // An anonymous request would 401 at best and silently read as "no data" at
  // worst, so treat a missing cookie as the programming error it is.
  if (!cookieHeader) throw new BackendError(401, path)

  const response = await fetch(`${config.BACKEND_URL}${path}`, {
    ...init,
    // The response is scoped to one user's cookie, so it must never be cached.
    cache: "no-store",
    headers: {
      ...headers,
      cookie: cookieHeader,
      ...(tenantId ? { "x-tenant-id": tenantId } : {}),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
  })

  if (!response.ok) throw new BackendError(response.status, path)

  if (response.status === 204) return undefined as T

  return (await response.json()) as T
}

/**
 * The call site for server components and server actions: reads the incoming
 * request's auth cookies and calls the backend as the signed-in user.
 *
 * Reading cookies excludes this from a `use cache` scope — Next throws there —
 * so every caller is uncached by construction. Gate with a lib/dal.ts `require*`
 * helper first, and pass the tenantId that gate returns.
 */
export async function backendFetch<T>(
  path: string,
  options: Omit<BackendRequestOptions, "cookieHeader"> = {}
): Promise<T> {
  const store = await cookies()
  return backendRequest<T>(path, {
    ...options,
    cookieHeader: authCookieHeader(store.getAll()),
  })
}
