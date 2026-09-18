import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { sale: { findMany } },
}));

import { getSalesService } from "@/api/services/sales.service";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SALE = "66666666-6666-4666-8666-666666666666";
const MACHINE = "33333333-3333-4333-8333-333333333333";

function saleRow(site: { id: string; name: string } | null) {
  return {
    id: SALE,
    tenantId: TENANT,
    machineId: MACHINE,
    machine: { id: MACHINE, name: "VM-001", site },
    productId: null,
    product: null,
    status: "completed",
    price: 10,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  findMany.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("getSalesService — the sales drop", () => {
  it("drops a sale whose machine has no site instead of crashing or lying about the type", async () => {
    findMany.mockResolvedValue([saleRow(null)]);

    const sales = await getSalesService(TENANT);

    expect(sales).toEqual([]);
  });

  it("keeps a sale whose machine does have a site", async () => {
    findMany.mockResolvedValue([saleRow({ id: "site-1", name: "Canteen" })]);

    const sales = await getSalesService(TENANT);

    expect(sales).toHaveLength(1);
    expect(sales[0]?.machine.site.id).toBe("site-1");
  });

  it("logs the invariant violation rather than dropping it silently", async () => {
    findMany.mockResolvedValue([saleRow(null)]);

    await getSalesService(TENANT);

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(SALE));
  });
});
