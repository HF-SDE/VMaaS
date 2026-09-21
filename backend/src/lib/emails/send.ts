import { config } from "../config";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import { Resend } from "resend";

export type EmailNotConfiguredError = { reason: "EMAIL_NOT_CONFIGURED"; message: string };
export type EmailSendFailedError = { reason: "EMAIL_SEND_FAILED"; message: string };
export type SendEmailError = EmailNotConfiguredError | EmailSendFailedError;

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Built once, on first use rather than at import time — constructing it eagerly
 * would make every module that transitively imports this one require a Resend
 * key, including the unit tests.
 */
let client: Resend | null = null;

function getClient(): Resend | null {
  if (!config.RESEND_API_KEY) return null;
  client ??= new Resend(config.RESEND_API_KEY);
  return client;
}

/**
 * Sends one transactional email.
 *
 * Answers a `Result` rather than throwing, because every caller so far is a
 * side effect of an action that has already succeeded — an invitation row is
 * written before its email goes out, and a bounced send must not roll that
 * back. Callers log the failure and carry on.
 *
 * With no `RESEND_API_KEY` configured the message is logged instead of sent and
 * the call fails with `EMAIL_NOT_CONFIGURED`, so a developer can read the
 * invitation link out of the server output and follow the flow without
 * credentials.
 */
export async function sendEmail({ to, subject, html }: EmailMessage): Promise<Result<SendEmailError, { id: string }>> {
  const resend = getClient();

  if (!resend) {
    console.info(`[emails] RESEND_API_KEY is not set — not sending "${subject}" to ${to}.\n${html}`);
    return err({
      reason: "EMAIL_NOT_CONFIGURED",
      message: "Email is not configured on this server.",
    });
  }

  try {
    const { data, error } = await resend.emails.send({ from: config.EMAIL_FROM, to, subject, html });

    if (error || !data) {
      console.error(`[emails] Resend rejected "${subject}" to ${to}`, error);
      return err({
        reason: "EMAIL_SEND_FAILED",
        message: error?.message ?? "The email provider rejected the message.",
      });
    }

    return ok({ id: data.id });
  } catch (cause) {
    console.error(`[emails] sending "${subject}" to ${to} failed`, cause);
    return err({
      reason: "EMAIL_SEND_FAILED",
      message: "Could not reach the email provider.",
    });
  }
}
