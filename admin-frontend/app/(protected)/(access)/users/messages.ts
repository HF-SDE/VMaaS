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
 * Wording for an invite. Only one status is about the person being invited
 * rather than about the request — a 409, someone already in the tenant — and it
 * is shown against the email field so it names the address the user typed.
 *
 * There is deliberately no "no account uses that address" case any more:
 * invitations are keyed on the email, so inviting someone who has never signed
 * up is the normal path, not an error.
 *
 * A 502 is the one status that needs to say what did *not* happen: the backend
 * writes the invitation and sends its email in one transaction, so a failed
 * send leaves nothing behind and retrying is safe.
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
      return "That organization no longer exists. Reload the page and try again."
    case 409:
      return `${email} is already a member of this tenant.`
    case 400:
      // The role list is fetched when the page renders; a role deleted since is
      // the only way a submitted form gets here.
      return "That role no longer exists. Reload the page and try again."
    case 500:
      return "An unexpected error occurred. Please try again."
    case 502:
      return `We could not email the invitation to ${email}, so nobody was invited. Please try again.`
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
