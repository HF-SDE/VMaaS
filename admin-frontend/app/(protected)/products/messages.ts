export function productsErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have access to products."
    case 404:
      return "That product no longer exists."
    case 400:
      return "That request could not be read. Reload the page and try again."
    case 409:
      return "That product is in use and cannot be changed."
    case 500:
      // The backend already logged the cause; the page only needs something to show.
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/** What the user was trying to do, used to word a failed write. */
export type ProductWriteAction = "create" | "save" | "delete" | "archive"

/**
 * Wording for a write, where the same `reason` means something else than it
 * does on a read — a 403 here is a missing write permission, not missing access
 * to the section, and CONFLICT only ever comes back from a blocked delete.
 */
export function productWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change products."
    case 404:
      return "That product no longer exists."
    case 409:
      return "That product is stocked in one or more slots and cannot be deleted. Archive it instead."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}
