import { prisma } from "@/lib/prisma";

import {
  PRODUCT_SORT_FIELDS,
  type GetProductsParams,
  type ProductSortField,
} from "@vmaas/shared/types/product";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_BY: ProductSortField = "createdAt";
const DEFAULT_SORT_ORDER = "desc" as const;

function isSortField(value: string): value is ProductSortField {
  return (PRODUCT_SORT_FIELDS as readonly string[]).includes(value);
}

export async function getProductsService(tenantId: string) {
  const machines = await prisma.product.findMany({ where: { tenantId } });

  return machines;
}

/**
 * One page of a tenant's products, with optional name search and sorting.
 *
 * Every parameter is clamped or whitelisted rather than rejected, so a stale
 * bookmark (`?page=9999&sortBy=bogus`) still renders instead of erroring.
 */
export async function getProductsPageService(tenantId: string, params: GetProductsParams = {}) {
  const page = Math.max(0, Math.trunc(params.page ?? 0));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)),
  );
  const sortBy = params.sortBy && isSortField(params.sortBy) ? params.sortBy : DEFAULT_SORT_BY;
  const sortOrder = params.sortOrder === "asc" ? "asc" : DEFAULT_SORT_ORDER;
  const search = params.search?.trim();

  const where = {
    tenantId,
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const [products, totalCount] = await prisma.$transaction([
    prisma.product.findMany({
      where,
      orderBy: { [sortBy]: sortOrder },
      skip: page * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    data: products,
    page,
    pageSize,
    pageCount: Math.ceil(totalCount / pageSize),
    totalCount,
  };
}

export async function createProductService(tenantId: string, name: string, price: number) {
  const machine = await prisma.product.create({ data: { name, tenantId, price } });

  return machine;
}
