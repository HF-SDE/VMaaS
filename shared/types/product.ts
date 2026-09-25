export interface GetProductsParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  includeArchived?: boolean;
}
/** What a product picker sends to `GET /api/products/simple-search`. `search` is
 *  required: the endpoint exists to answer a typed query, never to list. */
export interface SimpleProductSearchParams {
  search: string;
  limit?: number;
}

/** The minimum a product picker needs — the id it submits, plus the price that
 *  tells two products of the same name apart. `price` is a string because that
 *  is how a Prisma `Decimal` crosses the wire; `formatPrice` takes it as is. */
export interface SimpleProduct {
  id: string;
  name: string;
  price: string;
}

export interface ProductUsage {
  canDelete: boolean;
}

export const PRODUCT_SORT_FIELDS = ["name", "price", "createdAt"] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];
