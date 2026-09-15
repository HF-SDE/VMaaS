import { HttpError, Result, err, ok } from "@vmaas/shared/lib/error-handling"
import { getAuthCookie, HttpOptions } from "./fetch-helpers"
import { cookies } from "next/dist/server/request/cookies"
import { config } from "../config"

export async function serverFetch<TResponse, TBody = unknown>(
  path: string,
  options: HttpOptions<TBody> = {}
): Promise<Result<HttpError, TResponse>> {
  const { method = "GET", query, body } = options

  const url = new URL(path, config.NEXT_PUBLIC_BACKEND_URL)

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value))
      }
    }
  }

  const store = await cookies()

  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      origin: config.FRONTEND_URL,
      cookie: getAuthCookie(store.getAll()),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (!response.ok) {
    return err({
      reason: response.statusText,
      status: response.status,
    })
  }

  const data = (await response.json()) as TResponse

  return ok(data)
}
