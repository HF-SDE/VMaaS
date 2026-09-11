import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1, { message: "BETTER_AUTH_SECRET is required" }),
  GITHUB_CLIENT_ID: z.string().min(1, { message: "GITHUB_CLIENT_ID is required" }),
  GITHUB_CLIENT_SECRET: z.string().min(1, { message: "GITHUB_CLIENT_SECRET is required" }),
  FRONTEND_URL: z.url().default("http://localhost:3000"),
  RATE_LIMIT_RESET_MINUTES: z.coerce.number().int().positive().default(15),
  RATE_LIMIT_COUNT: z.coerce.number().int().positive().default(100),
});

export const config = schema.parse(process.env);
