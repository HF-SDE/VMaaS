export function machinesErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have access to machines."
    case 404:
      return "That machine no longer exists."
    case 400:
      return "That request could not be read. Reload the page and try again."
    case 409:
      return "That machine is in use and cannot be changed."
    case 500:
      // The backend already logged the cause; the page only needs something to show.
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/**
 * Wording for a slot write, which lives on a machine's page but answers with
 * codes of its own: a 400 is the product the body named being gone rather than
 * a malformed request, and a 409 is a quantity that no longer fits the capacity.
 */
export function slotWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change slots."
    case 404:
      return "That slot no longer exists."
    case 409:
      return "The stock does not fit the slot's capacity."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/** What the user was trying to do, used to word a failed write. */
export type MachineWriteAction = "create" | "save" | "delete" | "archive"

/**
 * Wording for a write, where the same `reason` means something else than it
 * does on a read — a 403 here is a missing write permission, not missing access
 * to the section, and CONFLICT only ever comes back from a blocked delete.
 */
export function machineWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change machines."
    case 404:
      return "That machine no longer exists."
    case 409:
      return "That machine is in use and cannot be deleted. Archive it instead."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}
