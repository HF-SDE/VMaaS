export function membersErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have access to members."
    case 404:
      return "That member is no longer part of this tenant."
    case 400:
      return "That request could not be read. Reload the page and try again."
    case 409:
      return "That member could not be changed. Reload the page and try again."
    case 500:
      // The backend already logged the cause; the page only needs something to show.
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/**
 * Wording for an invite, where the two statuses that matter are about the person
 * being invited rather than about the request: a 404 is an email no account
 * answers to, and a 409 is someone who is already in the tenant. Both are shown
 * against the email field, so they name the address the user typed.
 */
export function memberInviteErrorMessage(
  status: number,
  email: string
): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to invite members."
    case 404:
      return `No account uses ${email}. They need to sign up before they can be invited.`
    case 409:
      return `${email} is already a member of this tenant.`
    case 400:
      // The role list is fetched when the page renders; a role deleted since is
      // the only way a submitted form gets here.
      return "That role no longer exists. Reload the page and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}

/**
 * Wording for a write, where the same status means something else than it does
 * on a read — a 403 here is a missing `user:manage`, not missing access to the
 * section, and a 409 only ever comes back from a removal the backend blocks
 * (the last owner of a tenant).
 */
export function memberWriteErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return "Your session has expired. Sign in again."
    case 403:
      return "You do not have permission to change members."
    case 404:
      return "That member is no longer part of this tenant."
    case 409:
      return "That member cannot be removed. Assign another owner first."
    case 400:
      return "Check the fields and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    default:
      throw new Error(`Unexpected error - status: ${status}`)
  }
}
