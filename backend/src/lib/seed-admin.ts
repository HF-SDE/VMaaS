import { hashPassword } from "better-auth/crypto";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "../generated/prisma/client";

const MIN_PASSWORD_LENGTH = 8;

export type SeedAdmin = { email: string; password: string; name: string };

export type SeedAdminDb = Pick<PrismaClient, "user">;

/**
 * Reads the platform super admin to seed from SEED_ADMIN_* variables.
 * Returns null when none is configured, so environments without one
 * (CI, production) seed permissions only instead of failing.
 */
export function parseSeedAdmin(env: Record<string, string | undefined>): SeedAdmin | null {
  const email = env.SEED_ADMIN_EMAIL?.trim();
  const password = env.SEED_ADMIN_PASSWORD;

  if (!email && !password) return null;
  if (!email) throw new Error("SEED_ADMIN_PASSWORD is set but SEED_ADMIN_EMAIL is missing.");
  if (!password) throw new Error("SEED_ADMIN_EMAIL is set but SEED_ADMIN_PASSWORD is missing.");
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  return {
    email: email.toLowerCase(),
    password,
    name: env.SEED_ADMIN_NAME?.trim() || "Super Admin",
  };
}

/**
 * Idempotent: the seed runs on every backend start. A new user gets a
 * credential account hashed the same way Better Auth hashes sign-ups, so the
 * normal email/password login works. An existing user is only promoted; their
 * password is never overwritten by a seed.
 */
export async function seedSuperAdmin(
  db: SeedAdminDb,
  admin: SeedAdmin,
): Promise<"created" | "promoted" | "unchanged"> {
  const existing = await db.user.findUnique({
    where: { email: admin.email },
    select: { id: true, isSuperAdmin: true },
  });

  if (existing) {
    if (existing.isSuperAdmin) return "unchanged";
    await db.user.update({ where: { id: existing.id }, data: { isSuperAdmin: true } });
    return "promoted";
  }

  const id = randomUUID();

  await db.user.create({
    data: {
      id,
      email: admin.email,
      name: admin.name,
      emailVerified: true,
      isSuperAdmin: true,
      accounts: {
        create: { accountId: id, providerId: "credential", password: await hashPassword(admin.password) },
      },
    },
  });

  return "created";
}
