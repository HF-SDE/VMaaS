/** Wording for a failed role write, keyed by the backend's HTTP status. */
export function roleWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to manage roles."
    case 404:
      return "That role no longer exists."
    case 409:
      return "That role name is taken, or the role is still in use."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}
