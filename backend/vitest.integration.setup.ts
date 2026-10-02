import { inject } from "vitest";

// Runs before each test file is imported, so src/lib/prisma.ts connects to the
// container rather than the placeholder URL in testEnv.
process.env.DATABASE_URL = inject("databaseUrl");
