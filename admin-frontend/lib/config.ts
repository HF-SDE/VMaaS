import { z } from "zod"

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    /** Where the browser reaches the backend. Public, so Next inlines it. */
    NEXT_PUBLIC_BACKEND_URL: z
      .url({ protocol: /^https?$/ })
      .default("http://localhost:5000"),
  // Sent as the Origin header on server-side requests — must be in the
  // backend's trustedOrigins or Better Auth rejects POSTs with 403.
  FRONTEND_URL: z.url().default("http://localhost:3000"),
    /**
     * Where the Next server itself reaches the backend. Inside Docker that is the
     * compose service name, which the browser cannot resolve, so it is kept apart
     * from the public URL. Falls back to the public URL outside Docker.
     */
    BACKEND_INTERNAL_URL: z.url({ protocol: /^https?$/ }).optional(),
  })
  .transform((env) => ({
    ...env,
    BACKEND_INTERNAL_URL:
      env.BACKEND_INTERNAL_URL ?? env.NEXT_PUBLIC_BACKEND_URL,
  }))

export function parseConfig(env: Record<string, string | undefined>) {
  return schema.parse(env)
}

export const config = parseConfig({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL,
})
