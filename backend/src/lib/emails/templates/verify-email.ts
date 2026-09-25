import { renderLayout } from "../layout";

export type VerifyEmail = {
  /** Better Auth's link: it marks the address verified, then redirects to the
   *  callback URL the client asked for. */
  verifyUrl: string;
};

export function renderVerifyEmail({ verifyUrl }: VerifyEmail): { subject: string; html: string } {
  const body = `
    <p style="font-size:15px;line-height:24px;margin:0;">
      Confirm that this is your email address to finish setting up your VMaaS account.
    </p>`;

  return {
    subject: "Verify your email address for VMaaS",
    html: renderLayout({
      heading: "Verify your email address",
      body,
      button: { label: "Verify email address", url: verifyUrl },
      footer: "If you did not create a VMaaS account, you can safely ignore this email.",
    }),
  };
}
