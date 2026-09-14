import { Product } from "@prisma";

export interface GetProductsParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
  includeArchived?: boolean;
}
export interface ProductUsage {
  canDelete: boolean;
}

export type ProductDetail = Product & ProductUsage;

export const PRODUCT_SORT_FIELDS = ["name", "price", "createdAt"] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];
