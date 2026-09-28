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
  FRONTEND_URL: z.string().default("http://localhost:3000").transform(parseFrontendOrigins),
  RATE_LIMIT_RESET_MINUTES: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_COUNT: z.coerce.number().int().positive().default(1000),
  ACTIVATION_CODE_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  DEVICE_CERT_DAYS: z.coerce.number().int().positive().default(90),
  /** What a machine is told to connect to. Public, not the compose service name. */
  MQTT_PUBLIC_HOST: z.string().min(1).default("localhost"),
  MQTT_PUBLIC_PORT: z.coerce.number().int().positive().default(8883),
  /** Where the backend itself connects, as an MQTT client. */
  MQTT_URL: z.string().min(1).default("mqtts://emqx:8883"),
  MQTT_CLIENT_CERT: z.string().min(1).default("/pki/backend.crt"),
  MQTT_CLIENT_KEY: z.string().min(1).default("/pki/backend.key"),
  MQTT_USERNAME: z.string().min(1).default("vmaas-platform"),
  MQTT_PASSWORD: z.string().min(1, { message: "MQTT_PASSWORD is required" }),
  CA_CERT_PATH: z.string().min(1).default("/pki/ca.crt"),
  CA_KEY_PATH: z.string().min(1).default("/pki/ca.key"),
  EMQX_API_URL: z.url().default("http://emqx:18083"),
  EMQX_API_KEY: z.string().min(1, { message: "EMQX_API_KEY is required" }),
  EMQX_API_SECRET: z.string().min(16, {
    message: "EMQX_API_SECRET must be at least 16 characters",
  }),
  MQTT_INTERNAL_SECRET: z.string().min(16, {
    message: "MQTT_INTERNAL_SECRET must be at least 16 characters",
  }),
  /** Resend API key. Optional on purpose: without it `lib/emails` logs the
   *  message instead of sending it, so onboarding still works end-to-end on a
   *  machine without mail credentials. */
  RESEND_API_KEY: z.string().min(1).optional(),
  /** The From: address on transactional mail. Must be a domain verified in
   *  Resend, or the send is rejected. */
  EMAIL_FROM: z.string().min(1).default("no-reply@vmaas.dk"),

  /** Stripe secret key. Required to interact with the Stripe API. */
  STRIPE_SECRET_KEY: z.string().min(1, { message: "STRIPE_SECRET_KEY is required" }),
  /** Stripe price ID for the monthly plan. */
  STRIPE_PRICE_ID_MONTHLY: z.string().min(1, { message: "STRIPE_PRICE_ID_MONTHLY is required" }),
  /** Stripe price ID for the yearly plan. */
  STRIPE_PRICE_ID_YEARLY: z.string().min(1, { message: "STRIPE_PRICE_ID_YEARLY is required" }),
  /** Signing secret for the Stripe webhook endpoint (`whsec_…`). Without it the
   *  webhook cannot tell a real Stripe event from anyone who found the URL, and
   *  the handler grants access — so it has no default and no optional escape:
   *  a missing value must stop the process, not silently open the paywall.
   *  In development `stripe listen` prints the value to use. */
  STRIPE_WEBHOOK_SECRET: z.string().min(1, { message: "STRIPE_WEBHOOK_SECRET is required" }),
  /** Optional: without it Sentry.init is a no-op, so tests and CI run without
   *  error reporting. */
  SENTRY_DSN: z.string().min(1).optional(),
});

export const config = (() => {
  // Filter out keys with empty values
  const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));
  const parsed = schema.parse(env);
  return {
    ...parsed,
    APP_URL: parsed.FRONTEND_URL[0],
  };
})();
