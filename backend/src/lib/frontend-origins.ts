import { z } from "zod";

const origin = z.url({ protocol: /^https?$/ });

/**
 * FRONTEND_URL may list several origins separated by commas, e.g. the nginx
 * origin used in Docker and the bare `next dev` port used on the host. Every
 * entry is allowed for CORS and trusted by Better Auth.
 */
export function parseFrontendOrigins(value: string): string[] {
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (origins.length === 0) throw new Error("FRONTEND_URL must contain at least one origin");

  return origins.map((entry) => origin.parse(entry));
}
