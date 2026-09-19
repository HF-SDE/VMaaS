/** The query parameter carrying where to go after signing in. */
export const REDIRECT_PARAM = "redirect"

const DEFAULT_TARGET = "/"

/**
 * Narrows a `?redirect=` value to somewhere inside this app.
 *
 * Whatever is in the query string came from a link someone else may have
 * written — an invitation email, or a page an attacker controls. Echoing it
 * into `router.push` unchecked is an open redirect: `?redirect=https://evil.example`
 * would send a freshly signed-in user off-site, with the app's own sign-in page
 * lending it credibility.
 *
 * Only a path is accepted, and only one that cannot be read as an origin:
 *   - it must start with a single "/" — `//evil.example` is protocol-relative
 *     and browsers treat it as absolute;
 *   - it must not contain a backslash, which some browsers normalise to "/";
 *   - anything else falls back to the dashboard.
 */
export function safeRedirectTarget(
  value: string | null | undefined
): string {
  if (!value) return DEFAULT_TARGET
  if (!value.startsWith("/")) return DEFAULT_TARGET
  if (value.startsWith("//")) return DEFAULT_TARGET
  if (value.includes("\\")) return DEFAULT_TARGET

  return value
}

/** Builds a sign-in URL that returns to `target` afterwards. */
export function signInPath(target: string, base = "/login"): string {
  const safe = safeRedirectTarget(target)
  if (safe === DEFAULT_TARGET) return base

  return `${base}?${REDIRECT_PARAM}=${encodeURIComponent(safe)}`
}
