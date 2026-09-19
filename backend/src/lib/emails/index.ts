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

/** Fire-and-forget: a bounced invitation email must not undo the invitation
 *  row that was already written. The failure is logged inside `sendEmail`. */
export async function sendInvitationEmail(to: string, invitation: InvitationEmail) {
  const { subject, html } = renderInvitationEmail(invitation);
  return sendEmail({ to, subject, html });
}
