import { renderLayout } from "../layout";

export type PasswordResetEmail = {
  /** Better Auth's link: it validates the token, then redirects to the
   *  frontend's /reset-password page with the token in the query string. */
  resetUrl: string;
  /** Lifetime of the link, in minutes. */
  expiresInMinutes: number;
};

export function renderPasswordResetEmail({ resetUrl, expiresInMinutes }: PasswordResetEmail): {
  subject: string;
  html: string;
} {
  const body = `
    <p style="font-size:15px;line-height:24px;margin:0;">
      We received a request to reset the password for your VMaaS account.
      Use the link below to choose a new one.
    </p>`;

  return {
    subject: "Reset your VMaaS password",
    html: renderLayout({
      heading: "Reset your password",
      body,
      button: { label: "Reset password", url: resetUrl },
      footer: `This link expires in ${expiresInMinutes} minutes and can be used once.
       If you did not request a password reset, you can safely ignore this email;
       your password will not change.`,
    }),
  };
}
