import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Config (src/lib/config.ts) validates process.env at import time with no
    // defaults for these, so any test that transitively imports it needs them.
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      BETTER_AUTH_URL: "http://localhost:5000",
      BETTER_AUTH_SECRET: "test-secret-value",
    },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
