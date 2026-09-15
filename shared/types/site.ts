export interface GetSitesParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

/** What a site picker sends to `GET /api/sites/simple-search`. `search` is
 *  required: the endpoint exists to answer a typed query, never to list. */
export interface SimpleSiteSearchParams {
  search: string;
  limit?: number;
}

/** The minimum a site picker needs — the id it submits, plus enough to tell two
 *  sites of the same name apart. */
export interface SimpleSite {
  id: string;
  name: string;
  city: string | null;
}

/** How many machines stand at the site. Above zero, it cannot be deleted —
 *  `Machine.site` is `onDelete: Restrict`. */
export interface SiteUsage {
  machineCount: number;
  canDelete: boolean;
}

export const SITE_SORT_FIELDS = ["name", "city", "createdAt"] as const;
export type SiteSortField = (typeof SITE_SORT_FIELDS)[number];
