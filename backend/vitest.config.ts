import path from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Config (src/lib/config.ts) validates process.env at import time with no
 * defaults for these, so any test that transitively imports it needs them.
 * Shared with vitest.integration.config.ts, which overrides DATABASE_URL with
 * the throwaway container's address.
 */
export const testEnv = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  BETTER_AUTH_URL: "http://localhost:5000",
  BETTER_AUTH_SECRET: "test-secret-value",
  // Two origins, as docker-compose supplies. Links built from the config
  // must pick one rather than stringifying the list.
  FRONTEND_URL: "http://localhost:3000,http://localhost",
  MQTT_INTERNAL_SECRET: "test-internal-secret-value",
  MQTT_PASSWORD: "test-mqtt-password-value",
  EMQX_API_KEY: "test-emqx-api-key",
  EMQX_API_SECRET: "test-emqx-api-secret-value",
  // Stripe is never called in tests — the SDK is mocked — but config.ts
  // requires these to exist, and a test suite that only passes because a
  // gitignored .env happens to be present is not a passing test suite.
  STRIPE_SECRET_KEY: "sk_test_value",
  STRIPE_PRICE_ID_MONTHLY: "price_test_monthly",
  STRIPE_PRICE_ID_YEARLY: "price_test_yearly",
  STRIPE_WEBHOOK_SECRET: "whsec_test_value",
};

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a real database; they run from
    // vitest.integration.config.ts (`npm run test:integration`).
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    env: testEnv,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
