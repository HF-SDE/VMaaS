import { verifyPassword } from "better-auth/crypto";
import { describe, expect, it, vi } from "vitest";

import { type SeedAdminDb, parseSeedAdmin, seedSuperAdmin } from "@/lib/seed-admin";

describe("parseSeedAdmin", () => {
  it("returns null when no seed admin is configured", () => {
    expect(parseSeedAdmin({})).toBeNull();
  });

  it("reads email, password and name", () => {
    expect(
      parseSeedAdmin({
        SEED_ADMIN_EMAIL: "Admin@Example.com",
        SEED_ADMIN_PASSWORD: "correct horse battery",
        SEED_ADMIN_NAME: "Root",
      }),
    ).toEqual({ email: "admin@example.com", password: "correct horse battery", name: "Root" });
  });

  it("defaults the name", () => {
    const admin = parseSeedAdmin({ SEED_ADMIN_EMAIL: "a@b.dk", SEED_ADMIN_PASSWORD: "12345678" });
    expect(admin?.name).toBe("Super Admin");
  });

  it("rejects a half-configured admin", () => {
    expect(() => parseSeedAdmin({ SEED_ADMIN_EMAIL: "a@b.dk" })).toThrow(/SEED_ADMIN_PASSWORD/);
    expect(() => parseSeedAdmin({ SEED_ADMIN_PASSWORD: "12345678" })).toThrow(/SEED_ADMIN_EMAIL/);
  });

  it("rejects a password shorter than Better Auth's minimum", () => {
    expect(() => parseSeedAdmin({ SEED_ADMIN_EMAIL: "a@b.dk", SEED_ADMIN_PASSWORD: "short" })).toThrow(
      /at least 8/,
    );
  });
});

function fakeDb(existing: { id: string; isSuperAdmin: boolean } | null) {
  const db = {
    user: {
      findUnique: vi.fn(async () => existing),
      create: vi.fn(async ({ data }: { data: unknown }) => data),
      update: vi.fn(async ({ data }: { data: unknown }) => data),
    },
  };
  return db as unknown as SeedAdminDb & typeof db;
}

const admin = { email: "root@vmaas.local", password: "seed-password-1", name: "Root" };

describe("seedSuperAdmin", () => {
  it("creates a verified super admin with a credential account Better Auth can verify", async () => {
    const db = fakeDb(null);

    const result = await seedSuperAdmin(db, admin);

    expect(result).toBe("created");
    const { data } = db.user.create.mock.calls[0][0] as { data: any };
    expect(data).toMatchObject({ email: admin.email, name: "Root", emailVerified: true, isSuperAdmin: true });

    const account = data.accounts.create;
    expect(account.providerId).toBe("credential");
    expect(account.accountId).toBe(data.id);
    expect(account.password).not.toContain(admin.password);
    await expect(verifyPassword({ hash: account.password, password: admin.password })).resolves.toBe(true);
  });

  it("promotes an existing user without touching their password", async () => {
    const db = fakeDb({ id: "u1", isSuperAdmin: false });

    const result = await seedSuperAdmin(db, admin);

    expect(result).toBe("promoted");
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { isSuperAdmin: true } });
  });

  it("is a no-op for an existing super admin", async () => {
    const db = fakeDb({ id: "u1", isSuperAdmin: true });

    expect(await seedSuperAdmin(db, admin)).toBe("unchanged");
    expect(db.user.create).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
