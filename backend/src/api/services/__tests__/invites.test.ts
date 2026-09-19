import { getInviteService, respondToInviteService } from "@/api/services/tenants.service";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { inviteFindUnique, inviteUpdate, userRoleFindFirst, userRoleCreate, userRoleCount } = vi.hoisted(() => ({
  inviteFindUnique: vi.fn(),
  inviteUpdate: vi.fn(),
  userRoleFindFirst: vi.fn(),
  userRoleCreate: vi.fn(),
  userRoleCount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    tenantInvite: { findUnique: inviteFindUnique, update: inviteUpdate },
    userRole: { findFirst: userRoleFindFirst, create: userRoleCreate, count: userRoleCount },
  },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const INVITE = "22222222-2222-4222-8222-222222222222";

const VIEWER = { id: "u1", email: "invited@example.com" };

function invite(overrides: Record<string, unknown> = {}) {
  return {
    id: INVITE,
    email: "invited@example.com",
    userId: null,
    tenantId: TENANT,
    roleId: "role-1",
    status: "pending",
    expiresAt: new Date(Date.now() + 86_400_000),
    tenant: { name: "Acme" },
    role: { name: "operator" },
    invitedBy: { name: "Owner", email: "owner@example.com" },
    ...overrides,
  };
}

beforeEach(() => {
  for (const spy of [inviteFindUnique, inviteUpdate, userRoleFindFirst, userRoleCreate, userRoleCount]) spy.mockReset();
  userRoleCount.mockResolvedValue(0);
  userRoleFindFirst.mockResolvedValue(null);
  inviteUpdate.mockResolvedValue({});
});

describe("getInviteService", () => {
  it("reports an invitation addressed to the viewer as theirs", async () => {
    inviteFindUnique.mockResolvedValue(invite());

    const [, detail] = await getInviteService(INVITE, VIEWER);

    expect(detail).toMatchObject({ tenantName: "Acme", roleName: "operator", matchesViewer: true });
  });

  // Signed in as the wrong account is the edge case users actually hit. The
  // page has to be able to say so, which means this is a 200, not a 404.
  it("reports a mismatch instead of hiding the invitation", async () => {
    inviteFindUnique.mockResolvedValue(invite({ email: "someone.else@example.com" }));

    const [error, detail] = await getInviteService(INVITE, VIEWER);

    expect(error).toBeNull();
    expect(detail?.matchesViewer).toBe(false);
  });

  it("matches the address case-insensitively", async () => {
    inviteFindUnique.mockResolvedValue(invite({ email: "Invited@Example.com" }));

    const [, detail] = await getInviteService(INVITE, VIEWER);

    expect(detail?.matchesViewer).toBe(true);
  });

  it("404s an invitation that does not exist", async () => {
    inviteFindUnique.mockResolvedValue(null);

    const [error] = await getInviteService(INVITE, VIEWER);

    expect(error?.reason).toBe("INVITE_NOT_FOUND");
  });
});

describe("respondToInviteService", () => {
  it("creates the membership when accepted", async () => {
    inviteFindUnique.mockResolvedValue(invite());

    const [error] = await respondToInviteService(INVITE, VIEWER, "accepted");

    expect(error).toBeNull();
    expect(userRoleCreate).toHaveBeenCalledWith({
      data: { userId: "u1", tenantId: TENANT, roleId: "role-1" },
    });
  });

  // The page that offered the button is not a security boundary: accepting has
  // to re-check that the signed-in address is the invited one.
  it("refuses an invitation addressed to a different account", async () => {
    inviteFindUnique.mockResolvedValue(invite({ email: "someone.else@example.com" }));

    const [error] = await respondToInviteService(INVITE, VIEWER, "accepted");

    expect(error?.reason).toBe("INVITE_EMAIL_MISMATCH");
    expect(userRoleCreate).not.toHaveBeenCalled();
  });

  it("refuses an expired invitation and records the expiry", async () => {
    inviteFindUnique.mockResolvedValue(invite({ expiresAt: new Date(Date.now() - 1000) }));

    const [error] = await respondToInviteService(INVITE, VIEWER, "accepted");

    expect(error?.reason).toBe("INVITE_EXPIRED");
    expect(userRoleCreate).not.toHaveBeenCalled();
    expect(inviteUpdate).toHaveBeenCalledWith({ where: { id: INVITE }, data: { status: "expired" } });
  });

  it.each(["accepted", "rejected", "revoked"] as const)("refuses an invitation already %s", async (status) => {
    inviteFindUnique.mockResolvedValue(invite({ status }));

    const [error] = await respondToInviteService(INVITE, VIEWER, "accepted");

    expect(error?.reason).toBe("INVITE_NOT_PENDING");
    expect(userRoleCreate).not.toHaveBeenCalled();
  });

  // Joining by another route in the meantime must close the invite, not create
  // a second membership row.
  it("does not duplicate a membership the user already has", async () => {
    inviteFindUnique.mockResolvedValue(invite());
    userRoleFindFirst.mockResolvedValue({ id: "existing" });

    const [error] = await respondToInviteService(INVITE, VIEWER, "accepted");

    expect(error).toBeNull();
    expect(userRoleCreate).not.toHaveBeenCalled();
    expect(inviteUpdate).toHaveBeenCalled();
  });

  it("declining closes the invitation without granting membership", async () => {
    inviteFindUnique.mockResolvedValue(invite());

    const [error] = await respondToInviteService(INVITE, VIEWER, "rejected");

    expect(error).toBeNull();
    expect(userRoleCreate).not.toHaveBeenCalled();
    expect(inviteUpdate.mock.calls[0]![0].data).toMatchObject({ status: "rejected", acceptedAt: null });
  });
});
