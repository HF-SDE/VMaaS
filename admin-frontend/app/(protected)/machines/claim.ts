/**
 * Wording and formatting for claiming a machine.
 *
 * Claiming binds a machine that already exists in the platform — registered by
 * serial number before it shipped — to this tenant and a site, and answers a
 * one-time code the technician types on the machine's keypad. The code is
 * shown once and only its hash is stored, so the panel that displays it is the
 * only place it ever exists.
 */

/**
 * Wording for a failed claim.
 *
 * Mirrors `machineWriteErrorMessage` for the statuses the whole section shares,
 * and differs only where claiming answers something of its own.
 */
export function claimErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change machines."
    case 404:
      // The endpoint answers 404 both for a serial number no machine carries
      // and for a site that does not belong to this tenant, and HttpError
      // carries no body to tell them apart. Naming only the likelier one would
      // send someone hunting a correct serial number.
      return "No machine has that serial number, or the site no longer exists."
    case 409:
      return "That machine is already claimed. It has to be released before it can be claimed again."
    case 400:
      return "Check the fields and try again."
    default:
      // Any other 5xx: nginx sits in front of the backend and answers 502, 503
      // and 504 of its own. The caller cannot filter those out - clientFetch
      // puts response.statusText in `reason`, which is prose rather than a
      // symbol and empty over HTTP/2 - so a gateway blip must not become an
      // unhandled rejection inside the dialog.
      if (status >= 500) {
        // The backend already logged the cause; the dialog only needs something to show.
        return "An unexpected error occurred. Please try again."
      }
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/** Characters per group in a displayed setup code. */
const GROUP = 4

/**
 * Splits a setup code into groups, e.g. "AB3FKM72PQ9X" to "AB3F KM72 PQ9X".
 *
 * The code is read off this screen and entered one character at a time on a
 * twelve-key keypad, which takes upwards of forty key presses. Grouping is what
 * keeps a reader's place.
 */
export function formatSetupCode(code: string): string {
  const groups: string[] = []
  for (let i = 0; i < code.length; i += GROUP) {
    groups.push(code.slice(i, i + GROUP))
  }
  return groups.join(" ")
}

/**
 * How long a code has left, as "59:47", or "Expired".
 *
 * @param expiresAt When the code stops working, as the claim response gives it.
 * @param now Passed in rather than read here, so the caller ticks it and this
 *        stays a pure function.
 */
export function timeLeftLabel(expiresAt: string | Date, now: Date): string {
  const end = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  const ms = end.getTime() - now.getTime()

  // The exact expiry moment counts as expired: the backend's check is
  // `expiresAt <= now`, and a UI that still offered the code there would be
  // promising something the server refuses.
  if (!Number.isFinite(ms) || ms <= 0) return "Expired"

  const total = Math.floor(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}
