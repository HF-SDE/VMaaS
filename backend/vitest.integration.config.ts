import path from "node:path";
import { defineConfig } from "vitest/config";

import { testEnv } from "./vitest.config";

/**
 * Integration tests: the real services against a real PostgreSQL, started in a
 * throwaway Docker container by the global setup and removed afterwards. Needs
 * a running Docker daemon.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    globalSetup: ["./vitest.integration.global-setup.ts"],
    setupFiles: ["./vitest.setup.ts", "./vitest.integration.setup.ts"],
    env: testEnv,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
