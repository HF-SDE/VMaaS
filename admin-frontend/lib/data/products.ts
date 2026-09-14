import "server-only"

import { redirect, unstable_rethrow } from "next/navigation"

import {
  backendDetail,
  backendFetch,
  expectStatus,
  unexpectedBackendError,
  type UnexpectedBackendError,
} from "../backend"
import { err, ok, type Result } from "@vmaas/shared/lib/error-handling"
import type {
  GetProductsParams,
  ProductUsage,
} from "@vmaas/shared/types/product"
import type { GetPaginatedResult } from "@vmaas/shared/types/data-table"
import type { Product } from "@prisma"

/**
 * Why a tagged `reason` and not a message: the caller owns the wording (and the
 * language), while this layer only reports what went wrong. `status` is kept so
 * a caller that wants the raw code — logging, a retry rule — still has it.
 *
 * Each function below declares its own union of the codes its endpoint can
 * actually answer with, rather than sharing one wide error type. That is the
 * point of the pattern: PATCH /:id cannot answer 409, so handling a CONFLICT
 * there would be dead code, and DELETE /:id can, so forgetting it is a compile
 * error. The unions are built from the pieces below so the shared parts are
 * written once without collapsing back into a single catch-all type.
 */

/**
 * On every product route, because they all chain
 * `requireAuth → requireTenant → requirePermission(PRODUCT_*)`:
 * 400 no tenant selected (or a malformed payload), 401 signed out,
 * 403 not a member of the tenant / missing the permission.
 */
type ProductRouteError =
  | { reason: "BAD_REQUEST"; status: number }
  | { reason: "UNAUTHORIZED"; status: number }
  | { reason: "FORBIDDEN"; status: number }

/**
 * A product of another tenant answers 404 too, so this covers both "gone" and
 * "not yours" — the page renders the same notFound() either way.
 */
type ProductNotFoundError = { reason: "NOT_FOUND"; status: number }

/** Only a delete: machine slots still stock the product, or sales reference it. */
type ProductConflictError = { reason: "CONFLICT"; status: number }

/** A single product as `GET /api/products/:id` returns it. */
export type ProductDetail = Product & ProductUsage

export type GetProductsError = ProductRouteError | UnexpectedBackendError
export type CreateProductError = ProductRouteError | UnexpectedBackendError
export type GetProductError =
  ProductRouteError | ProductNotFoundError | UnexpectedBackendError
export type UpdateProductError =
  ProductRouteError | ProductNotFoundError | UnexpectedBackendError
export type SetProductArchivedError =
  ProductRouteError | ProductNotFoundError | UnexpectedBackendError
export type DeleteProductError =
  | ProductRouteError
  | ProductNotFoundError
  | ProductConflictError
  | UnexpectedBackendError

/**
 * `tenantId` must come from a lib/dal.ts `require*` gate. The backend re-checks
 * membership and permissions, so passing a foreign tenant 403s rather than leaking.
 */
export async function getProducts(): Promise<
  Result<GetProductsError, Product[]>
> {
  try {
    return ok(await backendFetch<Product[]>("/api/products"))
  } catch (error) {
    unstable_rethrow(error)
    const status = expectStatus(error, [400, 401, 403] as const)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}

/**
 * One page of products. The backend clamps `page`/`pageSize` and ignores an
 * unknown `sortBy`, so the result's own `page`/`pageSize` are the values that
 * were actually served — prefer them over the ones sent here.
 */
export async function getProductsPaginated(
  params: GetProductsParams
): Promise<Result<GetProductsError, GetPaginatedResult<Product>>> {
  try {
    return ok(
      await backendFetch<GetPaginatedResult<Product>>(
        "/api/products/paginated",
        {
          // Listed field by field rather than spread: an object literal is what makes
          // this assignable to the `query` record, and it keeps the wire names visible.
          query: {
            page: params.page,
            pageSize: params.pageSize,
            sortBy: params.sortBy,
            sortOrder: params.sortOrder,
            search: params.search,
            includeArchived: params.includeArchived,
          },
        }
      )
    )
  } catch (error) {
    unstable_rethrow(error)
    const status = expectStatus(error, [400, 401, 403] as const)
    const detail = backendDetail(error)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}

export async function createProduct(
  name: string,
  price: number
): Promise<Result<CreateProductError, Product>> {
  try {
    return ok(
      await backendFetch<Product>("/api/products", {
        method: "POST",
        json: { name, price },
      })
    )
  } catch (error) {
    unstable_rethrow(error)
    const status = expectStatus(error, [400, 401, 403] as const)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}

/** One product, with the slot count that decides whether it can be deleted. */
export async function getProduct(
  id: string
): Promise<Result<GetProductError, ProductDetail>> {
  try {
    return ok(await backendFetch<ProductDetail>(`/api/products/${id}`))
  } catch (error) {
    unstable_rethrow(error)
    const status = expectStatus(error, [400, 401, 403, 404] as const)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      case 404:
        return err({ reason: "NOT_FOUND", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}

export async function updateProduct(
  id: string,
  input: { name?: string; price?: number }
): Promise<Result<UpdateProductError, ProductDetail>> {
  try {
    return ok(
      await backendFetch<ProductDetail>(`/api/products/${id}`, {
        method: "PATCH",
        json: input,
      })
    )
  } catch (error) {
    unstable_rethrow(error)
    // No 409 here: updateProductController only ever answers PRODUCT_NOT_FOUND
    // or a 500, so a CONFLICT arm would be unreachable.
    const status = expectStatus(error, [400, 401, 403, 404] as const)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      case 404:
        return err({ reason: "NOT_FOUND", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}

/** Answers CONFLICT when machine slots still stock the product. */
export async function deleteProduct(
  id: string
): Promise<Result<DeleteProductError, null>> {
  try {
    await backendFetch<void>(`/api/products/${id}`, {
      method: "DELETE",
    })
    return ok(null)
  } catch (error) {
    unstable_rethrow(error)
    const status = expectStatus(error, [400, 401, 403, 404, 409] as const)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      case 404:
        return err({ reason: "NOT_FOUND", status })
      // Both PRODUCT_IN_USE and PRODUCT_REFERENCED land here — the wire cannot
      // tell them apart, so the caller offers archiving for either.
      case 409:
        return err({ reason: "CONFLICT", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}

export async function setProductArchived(
  id: string,
  archived: boolean
): Promise<Result<SetProductArchivedError, ProductDetail>> {
  const path = `/api/products/${id}/${archived ? "archive" : "unarchive"}`

  try {
    return ok(await backendFetch<ProductDetail>(path, { method: "POST" }))
  } catch (error) {
    unstable_rethrow(error)
    const status = expectStatus(error, [400, 401, 403, 404] as const)
    if (status === null) return err(unexpectedBackendError(error))

    switch (status) {
      case 400:
        return err({ reason: "BAD_REQUEST", status })
      case 401:
        return err({ reason: "UNAUTHORIZED", status })
      case 403:
        return err({ reason: "FORBIDDEN", status })
      case 404:
        return err({ reason: "NOT_FOUND", status })
      default:
        throw new Error(`Unhandled status ${status satisfies never}`)
    }
  }
}
