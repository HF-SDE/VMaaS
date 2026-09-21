import { escapeHtml, renderLayout } from "../layout";

export type InvitationEmail = {
  tenantName: string;
  roleName: string;
  /** The inviter's display name, falling back to their email. Undefined when
   *  neither could be resolved — the copy then omits the sentence entirely
   *  rather than printing "invited you by undefined". */
  invitedBy?: string;
  acceptUrl: string;
  expiresAt?: Date;
};

const EXPIRY_FORMAT = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
});

export function renderInvitationEmail({
  tenantName,
  roleName,
  invitedBy,
  acceptUrl,
  expiresAt,
}: InvitationEmail): { subject: string; html: string } {
  const inviter = invitedBy ? `${escapeHtml(invitedBy)} has invited you` : "You have been invited";

  const body = `
    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">
      ${inviter} to join <strong>${escapeHtml(tenantName)}</strong> on VMaaS
      as <strong>${escapeHtml(roleName)}</strong>.
    </p>
    <p style="font-size:15px;line-height:24px;margin:0;">
      You do not need an account yet — you can create one from the link below
      and the invitation will be waiting for you.
    </p>`;

  const footer = expiresAt
    ? `This invitation expires on ${escapeHtml(EXPIRY_FORMAT.format(expiresAt))} UTC.
       If you were not expecting it, you can safely ignore this email.`
    : "If you were not expecting this invitation, you can safely ignore this email.";

  return {
    subject: `You have been invited to join ${tenantName} on VMaaS`,
    html: renderLayout({
      heading: `Join ${tenantName}`,
      body,
      button: { label: "View invitation", url: acceptUrl },
      footer,
    }),
  };
}
