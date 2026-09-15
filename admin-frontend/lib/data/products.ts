// import { err, ok, type Result } from "@vmaas/shared/lib/error-handling"
// import type {
//   GetProductsParams,
//   ProductUsage,
// } from "@vmaas/shared/types/product"
// import type { GetPaginatedResult } from "@vmaas/shared/types/data-table"
// import type { Product } from "@prisma"
// import { fetchData } from "./data-fetch"

// /**
//  * Why a tagged `reason` and not a message: the caller owns the wording (and the
//  * language), while this layer only reports what went wrong. `status` is kept so
//  * a caller that wants the raw code — logging, a retry rule — still has it.
//  *
//  * Each function below declares its own union of the codes its endpoint can
//  * actually answer with, rather than sharing one wide error type. That is the
//  * point of the pattern: PATCH /:id cannot answer 409, so handling a CONFLICT
//  * there would be dead code, and DELETE /:id can, so forgetting it is a compile
//  * error. The unions are built from the pieces below so the shared parts are
//  * written once without collapsing back into a single catch-all type.
//  */

// /**
//  * On every product route, because they all chain
//  * `requireAuth → requireTenant → requirePermission(PRODUCT_*)`:
//  * 400 no tenant selected (or a malformed payload), 401 signed out,
//  * 403 not a member of the tenant / missing the permission.
//  */
// type ProductRouteError =
//   | { reason: "BAD_REQUEST"; status: number }
//   | { reason: "UNAUTHORIZED"; status: number }
//   | { reason: "FORBIDDEN"; status: number }

// /**
//  * A product of another tenant answers 404 too, so this covers both "gone" and
//  * "not yours" — the page renders the same notFound() either way.
//  */
// type ProductNotFoundError = { reason: "NOT_FOUND"; status: number }

// /** Only a delete: machine slots still stock the product, or sales reference it. */
// type ProductConflictError = { reason: "CONFLICT"; status: number }

// /** Anything the endpoint does not document — a 500, or a status nobody planned for. */
// type UnexpectedError = { reason: "UNEXPECTED_ERROR"; status: number }

// /** A single product as `GET /api/products/:id` returns it. */
// export type ProductDetail = Product & ProductUsage

// export type GetProductsError = ProductRouteError | UnexpectedError
// export type CreateProductError = ProductRouteError | UnexpectedError
// export type GetProductError =
//   ProductRouteError | ProductNotFoundError | UnexpectedError
// export type UpdateProductError =
//   ProductRouteError | ProductNotFoundError | UnexpectedError
// export type SetProductArchivedError =
//   ProductRouteError | ProductNotFoundError | UnexpectedError
// export type DeleteProductError =
//   | ProductRouteError
//   | ProductNotFoundError
//   | ProductConflictError
//   | UnexpectedError
