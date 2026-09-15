import path from "node:path"
import { defineConfig } from "vitest/config"

const stub = path.resolve(import.meta.dirname, "test/stubs/empty.ts")

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e"],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
      "server-only": stub,
      "client-only": stub,
    },
  },
})
