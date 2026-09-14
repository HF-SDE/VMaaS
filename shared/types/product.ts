export interface GetProductsParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  /** Archived products are left out unless this is set. */
  includeArchived?: boolean;
}

/**
 * What `GET /api/products/:id` adds to the product row.
 *
 * `slotCount` is how many machine slots stock the product. It decides whether
 * deleting is possible at all — `Slot.product` is `onDelete: Restrict`, so a
 * product in use cannot be removed.
 */
export interface ProductUsage {
  canDelete: boolean;
}

/** Columns `GetProductsParams["sortBy"]` accepts; anything else falls back to the default. */
export const PRODUCT_SORT_FIELDS = ["name", "price", "createdAt"] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];
