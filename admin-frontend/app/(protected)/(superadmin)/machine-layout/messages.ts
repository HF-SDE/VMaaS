/** Wording for a failed read of the machines without a tenant */
export function machineLoadErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "Only super admins can set up machines."
    default:
      // The backend already logged the cause; the page only needs something to show.
      return "The machines could not be loaded. Please try again."
  }
}

/**
 * Wording for a failed save of a slot layout. 422 is a slot the save would
 * remove that still holds stock: the response body names the offending slot
 * numbers, but `HttpError` discards the body (see `publishErrorMessage`), so
 * this points at where to fix it instead of repeating numbers it doesn't have.
 */
export function saveLayoutErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "The layout was rejected. Reload the page and try again."
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "Only super admins can change slot layouts."
    case 404:
      return "This machine no longer exists, or it has been given to a tenant."
    case 422:
      return "A slot you removed still holds stock. Empty it in the machine's stock view first, then change the layout."
    default:
      return "An unexpected error occurred. Please try again."
  }
}

/**
 * Wording for a refused publish. 422 is the machine's state, not the
 * request's shape: `HttpError` carries only a status (see `reason`/`status` in
 * shared/lib/error-handling.ts, `reason` being just `response.statusText`),
 * so the server's 422 body naming the unwired slots never reaches this
 * function. The message below points at the slot inspector's own "Not wired"
 * note instead, which says the same thing and is already on the page.
 */
export function publishErrorMessage(status: number): string {
  switch (status) {
    case 422:
      return "Every slot needs at least one motor pin before the wiring can be published. Select a slot above — the ones missing pins show a red \"Not wired\" note."
    case 404:
      return "The machine or that version no longer exists."
    case 403:
      return "Only a superadmin can publish a machine configuration."
    default:
      return "The configuration could not be published. Try again."
  }
}

/**
 * Wording for a failed read of a machine's publish history. Kept distinct
 * from "nothing published yet" (an empty list), which is a normal state, not
 * an error, and must not be shown when the request actually failed.
 */
export function configurationHistoryErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "Only super admins can view the publish history."
    case 404:
      return "This machine no longer exists."
    default:
      return "The publish history could not be loaded. Reload the page to try again."
  }
}
