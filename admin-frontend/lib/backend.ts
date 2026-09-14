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
    path: string,
    readonly detail?: string
  ) {
    super()
  }
}

/**
 * The backend answers every failure with `{ error: string }`. Anything else —
 * an nginx 502's HTML, a torn body, a stack-trace page from an unhandled throw —
 * is not something to put in front of a user, so it reads as no detail at all.
 */
async function errorDetail(response: Response): Promise<string | undefined> {
  if (!response.headers.get("content-type")?.includes("application/json"))
    return
  try {
    const body: unknown = await response.json()
    const error = (body as { error?: unknown })?.error
    return typeof error === "string" ? error : undefined
  } catch {
    return undefined
  }
}

/**
 * Narrows a caught value to the status codes one endpoint is specified to
 * answer with, so the `switch` that follows it can be exhaustive.
 *
 * Two things stand in the way of type safety in a `catch`: the binding is
 * `unknown` (what a function throws is not part of its type in TypeScript), and
 * `BackendError.status` is a plain `number` — a `switch` over a `number` can
 * never reach `satisfies never`, because there is always another number. Naming
 * the codes here fixes both: the return type is the literal union the caller
 * declared, so the default arm is genuinely unreachable and adding a code to
 * the list stops compiling until it has a case.
 *
 * `null` means the throw was none of them — a 500, a torn connection, a bug.
 * Those look the same on every endpoint, so callers map that one case through
 * `unexpectedBackendError` instead of restating it.
 */
export function expectStatus<const S extends readonly number[]>(
  error: unknown,
  expected: S
): S[number] | null {
  if (!(error instanceof BackendError)) return null

  return expected.includes(error.status) ? (error.status as S[number]) : null
}

/** The failures shared by every endpoint: a 500, or never getting a reply. */
export type UnexpectedBackendError =
  | { reason: "BACKEND_ERROR"; status: number }
  | { reason: "NETWORK_ERROR"; cause: unknown }

export function unexpectedBackendError(error: unknown): UnexpectedBackendError {
  return error instanceof BackendError
    ? { reason: "BACKEND_ERROR", status: error.status }
    : { reason: "NETWORK_ERROR", cause: error }
}

type QueryValue = string | number | boolean | null | undefined

type BackendRequestOptions = Omit<RequestInit, "body" | "cache"> & {
  cookieHeader: string
  json?: unknown
  /** Appended to `path` as a query string. */
  query?: Record<string, QueryValue>
}

/**
 * Nullish and empty values are dropped rather than serialised, so an untouched
 * optional param never reaches the backend as `?search=` — which would read as
 * a deliberate empty filter instead of "not set".
 */
function queryString(query: Record<string, QueryValue> | undefined): string {
  if (!query) return ""

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue
    params.set(key, String(value))
  }

  const serialised = params.toString()

  return serialised ? `?${serialised}` : ""
}

/**
 * Pure over its input so it is unit-testable: the caller supplies the cookie
 * header. Use `backendFetch` from a server component or action instead.
 */
export async function backendRequest<T>(
  path: string,
  { cookieHeader, json, query, headers, ...init }: BackendRequestOptions
): Promise<T> {
  // An anonymous request would 401 at best and silently read as "no data" at
  // worst, so treat a missing cookie as the programming error it is.
  if (!cookieHeader) throw new BackendError(401, path)

  const response = await fetch(
    `${config.NEXT_PUBLIC_BACKEND_URL}${path}${queryString(query)}`,
    {
      ...init,
      // The response is scoped to one user's cookie, so it must never be cached.
      cache: "no-store",
      headers: {
        ...headers,
        cookie: cookieHeader,
        ...(json !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    }
  )

  if (!response.ok)
    throw new BackendError(response.status, path, await errorDetail(response))

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
export function backendDetail(error: unknown): string | undefined {
  return error instanceof BackendError ? error.detail : undefined
}
