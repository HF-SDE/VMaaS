import { z } from "zod";

const origin = z.url({ protocol: /^https?$/ });

/**
 * FRONTEND_URL may list several origins separated by commas, e.g. the nginx
 * origin used in Docker and the bare `next dev` port used on the host. Every
 * entry is allowed for CORS and trusted by Better Auth.
 *
 * The **first** entry is the canonical one — `config.APP_URL` — and it is what
 * every link this backend builds points at, so order the value with the origin
 * users actually browse first. The return type is non-empty so `[0]` is a
 * `string`, matching the throw below.
 */
export function parseFrontendOrigins(value: string): [string, ...string[]] {
  const origins = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (origins.length === 0) throw new Error("FRONTEND_URL must contain at least one origin");

  return origins.map((entry) => origin.parse(entry)) as [string, ...string[]];
}
