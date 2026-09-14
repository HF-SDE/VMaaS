export function sitesErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have access to sites."
    case 404:
      return "That site no longer exists."
    case 400:
      return "That request could not be read. Reload the page and try again."
    case 409:
      return "That site is in use and cannot be changed."
    case 500:
      // The backend already logged the cause; the page only needs something to show.
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/** What the user was trying to do, used to word a failed write. */
export type SiteWriteAction = "create" | "save" | "delete"

/**
 * Wording for a write, where the same status means something else than it does
 * on a read — a 403 here is a missing write permission, not missing access to
 * the section, and 409 only ever comes back from a blocked delete.
 *
 * Sites have no archive to fall back on the way products do, so the 409 has to
 * tell the user what to do instead: move the machines off the site first.
 */
export function siteWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change sites."
    case 404:
      return "That site no longer exists."
    case 409:
      return "That site still has machines and cannot be deleted. Move them to another site first."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}
