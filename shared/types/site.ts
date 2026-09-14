export interface GetSitesParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

/** How many machines stand at the site. Above zero, it cannot be deleted —
 *  `Machine.site` is `onDelete: Restrict`. */
export interface SiteUsage {
  machineCount: number;
  canDelete: boolean;
}

export const SITE_SORT_FIELDS = ["name", "city", "createdAt"] as const;
export type SiteSortField = (typeof SITE_SORT_FIELDS)[number];
