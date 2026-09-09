import { z } from "zod"

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  BACKEND_URL: z.url().default("http://localhost:5000"),
})

export const config = schema.parse(process.env)
