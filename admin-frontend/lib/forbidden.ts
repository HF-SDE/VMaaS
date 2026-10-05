// This is the path that represents the forbidden page. Its defined as a constant so it can be referenced consistently throughout the codebase.
export const FORBIDDEN_PATH = "/forbidden"

export const FORBIDDEN_REASON_MAX_LENGTH = 200
export const FORBIDDEN_FALLBACK_REASON = "You don't have access to this page."

function clean(reason: string): string {
  return reason.trim().slice(0, FORBIDDEN_REASON_MAX_LENGTH)
}

export function forbiddenPath(reason?: string): string {
  const text = reason ? clean(reason) : ""
  if (!text) return FORBIDDEN_PATH

  return `${FORBIDDEN_PATH}?${new URLSearchParams({ reason: text })}`
}

export function readForbiddenReason(
  param: string | string[] | undefined
): string {
  const raw = Array.isArray(param) ? param[0] : param

  return (raw ? clean(raw) : "") || FORBIDDEN_FALLBACK_REASON
}
