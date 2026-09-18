import { getSalesMapService } from "@/api/services/sales.service";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@/lib/prisma", () => ({
  prisma: { sale: { findMany } },
}));

const TENANT = "11111111-1111-4111-8111-111111111111";
const SALE = "66666666-6666-4666-8666-666666666666";
const MACHINE = "33333333-3333-4333-8333-333333333333";
const SITE = "44444444-4444-4444-8444-444444444444";

type SiteRow = {
  id: string;
  name: string;
  latitude: unknown;
  longitude: unknown;
} | null;

function saleRow(site: SiteRow) {
  return {
    id: SALE,
    price: 12.5,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    product: { name: "Cola" },
    machine: { id: MACHINE, name: "VM-001", site },
  };
}

const locatedSite = {
  id: SITE,
  name: "Canteen",
  latitude: 55.6761,
  longitude: 12.5683,
};

/** The `createdAt.gte` the service asked the database for. */
function since(): Date | undefined {
  return findMany.mock.calls.at(-1)?.[0]?.where?.createdAt?.gte;
}

beforeEach(() => {
  findMany.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  // The window is measured from "now", so it needs a fixed one to assert on.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSalesMapService", () => {
  it("flattens a sale into one point carrying its site's coordinates", async () => {
    findMany.mockResolvedValue([saleRow(locatedSite)]);

    const [error, points] = await getSalesMapService(TENANT);

    expect(error).toBeNull();
    expect(points).toEqual([
      {
        id: SALE,
        price: 12.5,
        createdAt: "2026-01-01T00:00:00.000Z",
        productName: "Cola",
        machineId: MACHINE,
        machineName: "VM-001",
        siteId: SITE,
        siteName: "Canteen",
        latitude: 55.6761,
        longitude: 12.5683,
      },
    ]);
  });

  it("drops a sale whose site has no coordinates rather than plotting it at null island", async () => {
    findMany.mockResolvedValue([saleRow({ ...locatedSite, latitude: null, longitude: null })]);

    const [, points] = await getSalesMapService(TENANT);

    expect(points).toEqual([]);
  });

  it("drops a sale whose machine has no site at all", async () => {
    findMany.mockResolvedValue([saleRow(null)]);

    const [, points] = await getSalesMapService(TENANT);

    expect(points).toEqual([]);
  });

  it("asks the database only for this tenant's completed sales", async () => {
    findMany.mockResolvedValue([]);

    await getSalesMapService(TENANT);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: TENANT, status: "completed" }),
      }),
    );
  });

  it("looks back 30 days when the request does not say how far", async () => {
    findMany.mockResolvedValue([]);

    await getSalesMapService(TENANT);

    expect(since()).toEqual(new Date("2026-05-02T12:00:00.000Z"));
  });

  it("looks back as far as the request asks", async () => {
    findMany.mockResolvedValue([]);

    await getSalesMapService(TENANT, { days: 7 });

    expect(since()).toEqual(new Date("2026-05-25T12:00:00.000Z"));
  });

  it("clamps a window longer than a year rather than rejecting it", async () => {
    findMany.mockResolvedValue([]);

    await getSalesMapService(TENANT, { days: 99999 });

    expect(since()).toEqual(new Date("2025-06-01T12:00:00.000Z"));
  });

  it("clamps a zero or negative window to a single day", async () => {
    findMany.mockResolvedValue([]);

    await getSalesMapService(TENANT, { days: 0 });

    expect(since()).toEqual(new Date("2026-05-31T12:00:00.000Z"));
  });

  it("answers UNKNOWN_ERROR instead of throwing when the query fails", async () => {
    findMany.mockRejectedValue(new Error("connection lost"));

    const [error, points] = await getSalesMapService(TENANT);

    expect(error?.reason).toBe("UNKNOWN_ERROR");
    expect(points).toBeNull();
  });

  it("keeps a deleted product's sale on the map, without a product name", async () => {
    findMany.mockResolvedValue([{ ...saleRow(locatedSite), product: null }]);

    const [, points] = await getSalesMapService(TENANT);

    expect(points?.[0]?.productName).toBeNull();
  });
});
