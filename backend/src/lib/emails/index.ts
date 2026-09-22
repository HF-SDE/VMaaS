import { config } from "../config";
import { type SendEmailError, sendEmail } from "./send";
import { type InvitationEmail, renderInvitationEmail } from "./templates/invitation";

export { sendEmail };
export type { SendEmailError };

/** The page an invitation email links to. Carries only the invitation's id —
 *  the invite is read server-side and accepting it re-checks the signed-in
 *  user's email, so the id alone grants nothing. */
export function invitationUrl(invitationId: string): string {
  return `${config.APP_URL}/invite/${invitationId}`;
}

/** Answers a `Result` like `sendEmail` — `inviteMemberService` sends from inside
 *  the transaction that writes the invitation and rolls the row back when this
 *  fails, so the outcome has to reach the caller. */
export async function sendInvitationEmail(to: string, invitation: InvitationEmail) {
  const { subject, html } = renderInvitationEmail(invitation);
  return sendEmail({ to, subject, html });
}
