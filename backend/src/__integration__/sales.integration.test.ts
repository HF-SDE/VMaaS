import { getSalesMapService, getSalesService, getSalesSummaryService } from "@/api/services/sales.service";

import { beforeAll, describe, expect, it } from "vitest";

import { type TenantData, createTenantWithData } from "./fixtures";

let a: TenantData;
let b: TenantData;

beforeAll(async () => {
  a = await createTenantWithData("A");
  b = await createTenantWithData("B");
});

describe("sales are isolated between tenants", () => {
  it("lists only the tenant's own sales", async () => {
    const sales = await getSalesService(a.tenant.id);

    expect(sales.map((sale) => sale.id)).toEqual([a.sale.id]);
  });

  it("puts only the tenant's own sales on the map", async () => {
    const [error, points] = await getSalesMapService(a.tenant.id);

    expect(error).toBeNull();
    expect(points?.map((point) => point.id)).toEqual([a.sale.id]);
  });

  it("counts only the tenant's own sales in the summary", async () => {
    const [error, summary] = await getSalesSummaryService(a.tenant.id);

    expect(error).toBeNull();
    expect(summary?.last30Days.count).toBe(1);
    expect(summary?.topProducts.map((product) => product.productId)).toEqual([a.product.id]);
  });
});
