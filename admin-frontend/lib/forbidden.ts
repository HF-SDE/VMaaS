/**
 * The `/forbidden` URL shape lives here so the two writers (RoleGate and the
 * lib/dal.ts gates) and the one reader (the page) cannot drift apart.
 *
 * No "server-only": the path builder is plain string work, and a client
 * component that wants to link to /forbidden should be able to.
 */

export const FORBIDDEN_PATH = "/forbidden"

/** `reason` arrives from the URL, so a crafted link could otherwise drop an
 *  arbitrarily long message into the page's chrome. Cap it at a sentence or
 *  two — enough for real copy, too short to be a wall of text. */
export const FORBIDDEN_REASON_MAX_LENGTH = 200

export const FORBIDDEN_FALLBACK_REASON = "Du har ikke adgang til denne side."

function clean(reason: string): string {
  return reason.trim().slice(0, FORBIDDEN_REASON_MAX_LENGTH)
}

/**
 * Builds the redirect target. `reason` is plain Danish copy written at the call
 * site — the caller knows what was being guarded, so it words the denial.
 */
export function forbiddenPath(reason?: string): string {
  const text = reason ? clean(reason) : ""
  if (!text) return FORBIDDEN_PATH

  return `${FORBIDDEN_PATH}?${new URLSearchParams({ reason: text })}`
}

/**
 * Reads the param back for display. Next hands a repeated query param as an
 * array; the first value wins. Always returns something printable, so the page
 * never has to decide what an absent reason looks like.
 */
export function readForbiddenReason(
  param: string | string[] | undefined
): string {
  const raw = Array.isArray(param) ? param[0] : param

  return (raw ? clean(raw) : "") || FORBIDDEN_FALLBACK_REASON
}
