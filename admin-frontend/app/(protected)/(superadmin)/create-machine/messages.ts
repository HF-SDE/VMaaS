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
