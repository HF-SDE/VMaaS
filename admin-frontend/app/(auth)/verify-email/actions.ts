"use server";

import { auth } from "@/lib/auth";

export async function resendVerificationEmail(
  email: string,
): Promise<string | null> {
  try {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/" },
    });
    return null;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Noget gik galt. Prøv igen.";
    return message;
  }
}
