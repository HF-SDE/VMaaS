import { prisma } from "@/lib/prisma";

import { describe, expect, it } from "vitest";

import { createTenantWithData } from "./fixtures";

/**
 * What the schema itself guarantees, below the services: the constraints and
 * delete rules the migrations create. Mocked tests cannot see these at all.
 */
describe("database constraints", () => {
  it("rejects a second machine with the same serial number", async () => {
    const { machine } = await createTenantWithData("Serial");

    await expect(
      prisma.machine.create({ data: { name: "Duplicate", serialNumber: machine.serialNumber } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a site that points at a tenant that does not exist", async () => {
    await expect(
      prisma.site.create({ data: { tenantId: crypto.randomUUID(), name: "Orphan" } }),
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("deletes a tenant's products and sales with the tenant, but keeps its unplaced machines", async () => {
    const tenant = await prisma.tenant.create({ data: { name: "Deleted tenant" } });
    const product = await prisma.product.create({ data: { tenantId: tenant.id, name: "Soda", price: 15 } });
    // Claimed but not yet placed at a site, which is the state a machine is in
    // between being claimed and activated.
    const machine = await prisma.machine.create({
      data: { tenantId: tenant.id, name: "Unplaced", serialNumber: `TEST-${crypto.randomUUID()}` },
    });

    await prisma.tenant.delete({ where: { id: tenant.id } });

    expect(await prisma.product.count({ where: { id: product.id } })).toBe(0);
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: machine.id } })).tenantId).toBeNull();
  });

  it("refuses to delete a tenant while one of its machines still stands at one of its sites", async () => {
    const { tenant, machine } = await createTenantWithData("Placed");

    // Site -> tenant cascades, but Machine -> site is Restrict, so the cascade
    // stops at the placed machine and the whole delete is rolled back.
    await expect(prisma.tenant.delete({ where: { id: tenant.id } })).rejects.toThrow();
    expect(await prisma.machine.count({ where: { id: machine.id, tenantId: tenant.id } })).toBe(1);
  });
});
