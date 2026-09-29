import {
  deleteProductService,
  getProductByIdService,
  getProductsService,
  setProductArchivedService,
  updateProductService,
} from "@/api/services/products.service";
import { prisma } from "@/lib/prisma";

import { beforeAll, describe, expect, it } from "vitest";

import { type TenantData, createTenantWithData } from "./fixtures";

let a: TenantData;
let b: TenantData;

beforeAll(async () => {
  a = await createTenantWithData("A");
  b = await createTenantWithData("B");
});

describe("products are isolated between tenants", () => {
  it("lists only the tenant's own products", async () => {
    const [error, products] = await getProductsService(a.tenant.id);

    expect(error).toBeNull();
    expect(products?.map((product) => product.id)).toEqual([a.product.id]);
  });

  it("reads another tenant's product id as not found", async () => {
    const [error] = await getProductByIdService(a.tenant.id, b.product.id);

    expect(error?.reason).toBe("PRODUCT_NOT_FOUND");
  });

  it("cannot change another tenant's product price", async () => {
    const [error] = await updateProductService(a.tenant.id, b.product.id, { price: 1 });

    expect(error?.reason).toBe("PRODUCT_NOT_FOUND");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } })).price.toNumber()).toBe(15);
  });

  it("cannot archive another tenant's product", async () => {
    const [error] = await setProductArchivedService(a.tenant.id, b.product.id, true);

    expect(error?.reason).toBe("PRODUCT_NOT_FOUND");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: b.product.id } })).archivedAt).toBeNull();
  });

  it("cannot delete another tenant's product", async () => {
    const [error] = await deleteProductService(a.tenant.id, b.product.id);

    expect(error?.reason).toBe("PRODUCT_NOT_FOUND");
    expect(await prisma.product.count({ where: { id: b.product.id } })).toBe(1);
  });
});
