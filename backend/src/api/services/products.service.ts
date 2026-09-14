import { Prisma, type Product } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

import { type Result, err, ok } from "@vmaas/shared/lib/error-handling";
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";
import {
  type GetProductsParams,
  PRODUCT_SORT_FIELDS,
  type ProductSortField,
  type ProductUsage,
} from "@vmaas/shared/types/product";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SORT_BY: ProductSortField = "createdAt";
const DEFAULT_SORT_ORDER = "desc" as const;

/**
 * Every service below answers a `Result` tuple instead of throwing or returning
 * `null`, so each failure the caller has to handle is a named `reason` the
 * controller switches on exhaustively — a new reason then fails to compile
 * until the controller words it.
 */
export type ProductNotFoundError = { reason: "PRODUCT_NOT_FOUND"; message: string };
export type ProductInUseError = { reason: "PRODUCT_IN_USE"; message: string };
export type ProductReferencedError = { reason: "PRODUCT_REFERENCED"; message: string };
export type UnknownProductError = { reason: "UNKNOWN_ERROR"; message: string };

/** A product row plus the usage fields `getProductByIdService` derives. */
export type ProductDetail = Product & ProductUsage;

function isSortField(value: string): value is ProductSortField {
  return (PRODUCT_SORT_FIELDS as readonly string[]).includes(value);
}

const PRODUCT_NOT_FOUND: ProductNotFoundError = {
  reason: "PRODUCT_NOT_FOUND",
  message: "The product does not exist.",
};

/**
 * The catch-all for a throw no service anticipated — a dropped connection, a
 * constraint nobody modelled. The thrown value never reaches the response; it
 * is logged here so the caller only has to render one generic failure.
 */
function unknownError(action: string, cause: unknown): Result<UnknownProductError, never> {
  // TODO: capture sentry error
  console.error(`[products.service] ${action} failed`, cause);

  return err({
    reason: "UNKNOWN_ERROR",
    message: `An unknown error occurred while ${action} the product.`,
  });
}

export async function getProductsService(tenantId: string): Promise<Result<UnknownProductError, Product[]>> {
  try {
    return ok(await prisma.product.findMany({ where: { tenantId } }));
  } catch (error) {
    return unknownError("listing", error);
  }
}

/**
 * One page of a tenant's products, with optional name search and sorting.
 *
 * Every parameter is clamped or whitelisted rather than rejected, so a stale
 * bookmark (`?page=9999&sortBy=bogus`) still renders instead of erroring.
 */
export async function getProductsPageService(
  tenantId: string,
  params: GetProductsParams = {},
): Promise<Result<UnknownProductError, GetPaginatedResult<Product>>> {
  const page = Math.max(0, Math.trunc(params.page ?? 0));
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(params.pageSize ?? DEFAULT_PAGE_SIZE)));
  const sortBy = params.sortBy && isSortField(params.sortBy) ? params.sortBy : DEFAULT_SORT_BY;
  const sortOrder = params.sortOrder === "asc" ? "asc" : DEFAULT_SORT_ORDER;
  const search = params.search?.trim();

  const where = {
    tenantId,
    ...(params.includeArchived ? {} : { archivedAt: null }),
    ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
  };

  try {
    const [products, totalCount] = await prisma.$transaction([
      prisma.product.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: page * pageSize,
        take: pageSize,
      }),
      prisma.product.count({ where }),
    ]);

    return ok({
      data: products,
      page,
      pageSize,
      pageCount: Math.ceil(totalCount / pageSize),
      totalCount,
    });
  } catch (error) {
    return unknownError("listing", error);
  }
}

export async function createProductService(
  tenantId: string,
  name: string,
  price: number,
): Promise<Result<UnknownProductError, Product>> {
  try {
    return ok(await prisma.product.create({ data: { name, tenantId, price } }));
  } catch (error) {
    return unknownError("creating", error);
  }
}

/**
 * One product, plus whether anything still references it.
 *
 * Every function below matches on `id` *and* `tenantId`, so a product belonging
 * to another tenant reads as "not found" rather than being served or written.
 */
export async function getProductByIdService(
  tenantId: string,
  id: string,
): Promise<Result<ProductNotFoundError | UnknownProductError, ProductDetail>> {
  try {
    const product = await prisma.product.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { slots: true, sales: true } } },
    });

    if (!product) return err(PRODUCT_NOT_FOUND);

    const { _count, ...rest } = product;

    return ok({ ...rest, canDelete: _count.slots + _count.sales === 0 });
  } catch (error) {
    return unknownError("reading", error);
  }
}

export async function updateProductService(
  tenantId: string,
  id: string,
  data: { name?: string; price?: number },
): Promise<Result<ProductNotFoundError | UnknownProductError, ProductDetail>> {
  try {
    // updateMany rather than update: it takes the tenant in its filter, where
    // `update` only accepts a unique field and would write across tenants.
    const { count } = await prisma.product.updateMany({ where: { id, tenantId }, data });

    if (count === 0) return err(PRODUCT_NOT_FOUND);
  } catch (error) {
    return unknownError("updating", error);
  }

  return getProductByIdService(tenantId, id);
}

/** `archived` false clears the timestamp, which is what makes a product active again. */
export async function setProductArchivedService(
  tenantId: string,
  id: string,
  archived: boolean,
): Promise<Result<ProductNotFoundError | UnknownProductError, ProductDetail>> {
  try {
    const { count } = await prisma.product.updateMany({
      where: { id, tenantId },
      data: { archivedAt: archived ? new Date() : null },
    });

    if (count === 0) return err(PRODUCT_NOT_FOUND);
  } catch (error) {
    return unknownError(archived ? "archiving" : "unarchiving", error);
  }

  return getProductByIdService(tenantId, id);
}

/**
 * The slot check is done here rather than left to `Slot.product`'s
 * `onDelete: Restrict`: the constraint would surface as an opaque Prisma error,
 * while this reports a case the UI can word for the user.
 */
export async function deleteProductService(
  tenantId: string,
  id: string,
): Promise<
  Result<
    ProductNotFoundError | ProductInUseError | ProductReferencedError | UnknownProductError,
    { deletedProductId: string }
  >
> {
  try {
    const product = await prisma.product.findFirst({
      where: { id, tenantId },
      select: { _count: { select: { slots: true, sales: true } } },
    });
    if (!product) return err(PRODUCT_NOT_FOUND);
    if (product._count.slots + product._count.sales > 0)
      return err({
        reason: "PRODUCT_IN_USE",
        message: "The product is in use.",
      });
    await prisma.product.delete({ where: { id, tenantId } });
    return ok({ deletedProductId: id });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return err(PRODUCT_NOT_FOUND);
      }

      if (error.code === "P2003") {
        return unknownError("deleting", error);
      }
    }

    return unknownError("deleting", error);
  }
}
