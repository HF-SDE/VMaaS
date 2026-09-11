/**
 * A product as the backend serialises it over JSON: Prisma's `Decimal` price
 * arrives as a string and `createdAt` as an ISO timestamp, never as `Decimal`/`Date`.
 */
export type Product = {
  id: string;
  tenantId: string;
  name: string;
  price: string;
  createdAt: string;
};
export enum machine_status {
  ONLINE = "online",
  OFFLINE = "offline",
  ERROR = "error",
}
export interface GetProductsParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

/** Columns `GetProductsParams["sortBy"]` accepts; anything else falls back to the default. */
export const PRODUCT_SORT_FIELDS = ["name", "price", "createdAt"] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

/**
 * One page of products, as returned by `GET /api/products/paginated`.
 * `page`/`pageSize` echo the values the backend actually used after clamping,
 * so the client can trust them even when it sent something out of range.
 */
export interface GetProductsResult {
  data: Product[];
  page: number; // 0-based
  pageSize: number;
  pageCount: number;
  totalCount: number;
}
