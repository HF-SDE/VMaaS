import { err, ok } from "@vmaas/shared/lib/error-handling"
import { config } from "../config"

export async function backendPost<T = unknown>(path: string, body: T) {
  const res = await fetch(config.NEXT_PUBLIC_BACKEND_URL + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const error = await res.json()
    return err({
      reason: "ERROR",
      message: error.message,
      status: res.status,
    })
  }

  return ok(await res.json())
}
