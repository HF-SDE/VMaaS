import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";
import "vitest";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Starts a fresh PostgreSQL for the integration run and applies the same
 * migrations production runs, so the tests see the real schema, constraints
 * and cascades. The container, and every row the tests wrote, is removed when
 * the run ends.
 */
export default async function setup(project: TestProject) {
  const container = await new PostgreSqlContainer("postgres:17-alpine").start();
  const databaseUrl = container.getConnectionUri();

  execSync("npx prisma migrate deploy", {
    cwd: __dirname,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "pipe",
  });

  project.provide("databaseUrl", databaseUrl);

  return async () => await container.stop();
}
