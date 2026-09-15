import { z } from "zod"

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  NEXT_PUBLIC_BACKEND_URL: z.url().default("http://localhost:5000"),
  // Sent as the Origin header on server-side requests — must be in the
  // backend's trustedOrigins or Better Auth rejects POSTs with 403.
  FRONTEND_URL: z.url().default("http://localhost:3000"),
})

export const config = schema.parse(process.env)
