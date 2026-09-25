import { clientFetch } from "./client-fetch"
import type { HttpOptions } from "./fetch-helpers"
import type { HttpError, Result } from "@vmaas/shared/lib/error-handling"

export async function fetchData<TResponse, TBody = unknown>(
  path: string,
  options: HttpOptions<TBody> = {}
): Promise<Result<HttpError, TResponse>> {
  if (typeof window === "undefined") {
    const { serverFetch } = await import("./server-fetch")
    return serverFetch<TResponse, TBody>(path, options)
  }

  return clientFetch<TResponse, TBody>(path, options)
}
