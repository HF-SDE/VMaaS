import * as Sentry from "@sentry/nextjs"

/** The query parameter carrying where to go after signing in. */
export const REDIRECT_PARAM = "redirect"

const DEFAULT_TARGET = "/"

// Ensures that a redirect target is safe and internal to the app.
export function safeRedirectTarget(value: string | null | undefined): string {
  if (!value) return DEFAULT_TARGET

  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    // A crafted link is the usual way to get here, so flag it as a possible
    // open-redirect attempt.
    Sentry.captureMessage("Blocked unsafe redirect target", {
      level: "warning",
      extra: { target: value },
    })
    return DEFAULT_TARGET
  }

  return value
}

export function signInPath(target: string, base = "/login"): string {
  const safe = safeRedirectTarget(target)
  if (safe === DEFAULT_TARGET) return base

  return `${base}?${REDIRECT_PARAM}=${encodeURIComponent(safe)}`
}
