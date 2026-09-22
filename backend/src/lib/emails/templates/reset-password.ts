import { escapeHtml, renderLayout } from "../layout";

export type ResetPasswordEmail = {
  /** The user's display name, falling back to their email upstream. Undefined
   *  when neither is worth printing — the copy then opens impersonally rather
   *  than greeting "undefined". */
  name?: string;
  resetUrl: string;
};

export function renderResetPasswordEmail({ name, resetUrl }: ResetPasswordEmail): {
  subject: string;
  html: string;
} {
  const greeting = name ? `${escapeHtml(name)}, someone` : "Someone";

  const body = `
    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">
      ${greeting} asked to reset the password for your VMaaS account.
      Use the button below to choose a new one.
    </p>
    <p style="font-size:15px;line-height:24px;margin:0;">
      Your current password stays valid until you finish, so nothing changes if
      you do nothing.
    </p>`;

  return {
    subject: "Reset your VMaaS password",
    html: renderLayout({
      heading: "Reset your password",
      body,
      button: { label: "Choose a new password", url: resetUrl },
      footer:
        "This link expires in 1 hour and can only be used once. " +
        "If you did not request it, you can safely ignore this email.",
    }),
  };
}
