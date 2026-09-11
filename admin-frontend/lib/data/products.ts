import "server-only"

import { unstable_rethrow } from "next/navigation"

import { BackendError, backendFetch } from "../backend"
import { err, ok, type Result } from "../error-handling"
import type {
  GetProductsParams,
  GetProductsResult,
  Product,
} from "@vmaas/shared/types/product"

/**
 * Why a tagged `reason` and not a message: the caller owns the wording (and the
 * language), while this layer only reports what went wrong. `status` is kept so
 * a caller that wants the raw code — logging, a retry rule — still has it.
 */
export type ProductsError =
  | { reason: "unauthorized"; status: number }
  | { reason: "forbidden"; status: number }
  | { reason: "not_found"; status: number }
  | { reason: "backend_error"; status: number }
  | { reason: "network_error"; cause: unknown }

export type ProductsResult<T> = Result<ProductsError, T>

/**
 * Next signals redirect/notFound/dynamic-bailout by throwing, so every catch
 * here has to hand those back to the framework before treating the throw as a
 * failed request — `unstable_rethrow` throws again for exactly those.
 */
function toProductsError(error: unknown): ProductsError {
  unstable_rethrow(error)

  if (!(error instanceof BackendError)) return { reason: "network_error", cause: error }

  switch (error.status) {
    case 401:
      return { reason: "unauthorized", status: error.status }
    case 403:
      return { reason: "forbidden", status: error.status }
    case 404:
      return { reason: "not_found", status: error.status }
    default:
      return { reason: "backend_error", status: error.status }
  }
}

/**
 * `tenantId` must come from a lib/dal.ts `require*` gate. The backend re-checks
 * membership and permissions, so passing a foreign tenant 403s rather than leaking.
 */
export async function getProducts(
  tenantId: string
): Promise<ProductsResult<Product[]>> {
  try {
    return ok(await backendFetch<Product[]>("/api/products", { tenantId }))
  } catch (error) {
    return err(toProductsError(error))
  }
}

/**
 * One page of products. The backend clamps `page`/`pageSize` and ignores an
 * unknown `sortBy`, so the result's own `page`/`pageSize` are the values that
 * were actually served — prefer them over the ones sent here.
 */
export async function getProductsPaginated(
  tenantId: string,
  params: GetProductsParams
): Promise<ProductsResult<GetProductsResult>> {
  try {
    return ok(
      await backendFetch<GetProductsResult>("/api/products/paginated", {
        tenantId,
        // Listed field by field rather than spread: an object literal is what makes
        // this assignable to the `query` record, and it keeps the wire names visible.
        query: {
          page: params.page,
          pageSize: params.pageSize,
          sortBy: params.sortBy,
          sortOrder: params.sortOrder,
          search: params.search,
        },
      })
    )
  } catch (error) {
    return err(toProductsError(error))
  }
}

export async function createProduct(
  tenantId: string,
  name: string,
  price: number
): Promise<ProductsResult<Product>> {
  try {
    return ok(
      await backendFetch<Product>("/api/products", {
        method: "POST",
        tenantId,
        json: { name, price },
      })
    )
  } catch (error) {
    return err(toProductsError(error))
  }
}
