import dotenv from "dotenv";
import { z } from "zod";

import { parseFrontendOrigins } from "./frontend-origins";

dotenv.config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.url(),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(1, { message: "BETTER_AUTH_SECRET is required" }),
  GITHUB_CLIENT_ID: z.string().min(1, { message: "GITHUB_CLIENT_ID is required" }).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1, { message: "GITHUB_CLIENT_SECRET is required" }).optional(),
  /** One or more browser origins, comma separated. See lib/frontend-origins.ts. */
  FRONTEND_URL: z.string().default("http://localhost:3000").transform(parseFrontendOrigins),
  RATE_LIMIT_RESET_MINUTES: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_COUNT: z.coerce.number().int().positive().default(1000),
  ACTIVATION_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  DEVICE_CERT_DAYS: z.coerce.number().int().positive().default(90),
  /** What a machine is told to connect to. Public, not the compose service name. */
  MQTT_PUBLIC_HOST: z.string().min(1).default("localhost"),
  MQTT_PUBLIC_PORT: z.coerce.number().int().positive().default(8883),
  /** Where the backend itself connects, as an MQTT client (spec §4.2). */
  MQTT_URL: z.string().min(1).default("mqtts://emqx:8883"),
  MQTT_CLIENT_CERT: z.string().min(1).default("/pki/backend.crt"),
  MQTT_CLIENT_KEY: z.string().min(1).default("/pki/backend.key"),
  /** The backend's own EMQX built-in-db credentials, provisioned declaratively
   *  — see config/emqx/auth-built-in-db-bootstrap.csv. `MQTT_USERNAME` is an
   *  identity, not a secret — it must equal that file's `user_id` column, so
   *  it keeps a default. `MQTT_PASSWORD` is the credential: no default, like
   *  MQTT_INTERNAL_SECRET below — a guessable shipped password is worse than
   *  a startup failure. Its value must equal that file's `password` column;
   *  nothing enforces that beyond this comment. */
  MQTT_USERNAME: z.string().min(1).default("vmaas-platform"),
  MQTT_PASSWORD: z.string().min(1, { message: "MQTT_PASSWORD is required" }),
  CA_CERT_PATH: z.string().min(1).default("/pki/ca.crt"),
  CA_KEY_PATH: z.string().min(1).default("/pki/ca.key"),
  /** EMQX's management API, used to kick an already-connected machine off its
   *  MQTT session when it is disabled — see lib/emqx.ts. A URL is not a
   *  secret, so it keeps a default; the key and secret authenticate against
   *  the admin API that can disconnect clients, so — like MQTT_INTERNAL_SECRET
   *  below — a guessable shipped default is worse than a startup failure. */
  EMQX_API_URL: z.url().default("http://emqx:18083"),
  EMQX_API_KEY: z.string().min(1, { message: "EMQX_API_KEY is required" }),
  EMQX_API_SECRET: z.string().min(16, {
    message: "EMQX_API_SECRET must be at least 16 characters",
  }),
  /** No default: a guessable shared secret between EMQX and this backend is worse than a startup failure. */
  MQTT_INTERNAL_SECRET: z.string().min(16, {
    message: "MQTT_INTERNAL_SECRET must be at least 16 characters",
  }),
  /** Resend API key. Optional on purpose: without it `lib/emails` logs the
   *  message instead of sending it, so onboarding still works end-to-end on a
   *  machine that has no mail credentials. A missing key must never be the
   *  reason an invitation cannot be created. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** The From: address on transactional mail. Must be a domain verified in
   *  Resend, or Resend rejects the send. */
  EMAIL_FROM: z.string().min(1).default("no-reply@vmaas.dk"),
  /** Public origin used to build links inside emails. Distinct from
   *  FRONTEND_URL, which is a CORS/trusted-origin list and may hold several
   *  entries — a link needs exactly one. Defaults to the first of those. */
  APP_URL: z.url({ protocol: /^https?$/ }).optional(),
});

export const config = (() => {
  const parsed = schema.parse(process.env);
  return { ...parsed, APP_URL: parsed.APP_URL ?? parsed.FRONTEND_URL[0]! };
})();
