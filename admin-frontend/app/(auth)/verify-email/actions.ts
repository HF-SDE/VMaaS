"use server";

import { authClient } from "@/lib/auth-client";

export async function resendVerificationEmail(
  email: string,
): Promise<string | null> {
  try {
    const { error } = await authClient.sendVerificationEmail({
      email,
      callbackURL: "/",
    });
    if (error) {
      return error.message ?? "Noget gik galt. Prøv igen.";
    }
    return null;
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Noget gik galt. Prøv igen.";
    return message;
  }
}
