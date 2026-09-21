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

/** Wording for a failed save of a slot layout */
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
    default:
      return "An unexpected error occurred. Please try again."
  }
}

/** Wording for a failed create of a machine */
export function createMachineErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "The machine was rejected. Check the name and try again."
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "Only super admins can create machines."
    default:
      return "An unexpected error occurred. Please try again."
  }
}
