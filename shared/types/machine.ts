import type { SimpleSite } from "./site";

export interface GetMachinesParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

export interface MachineUsage {
  canDelete: boolean;
}

/** Every machine stands at a site — `Machine.siteId` is required, not nullable —
 *  so the list and the detail both include the site the UI has to name, rather
 *  than leaving the client to resolve an id. */
export interface MachineSite {
  site: SimpleSite;
}

/** `site` sorts by the site's name rather than by the raw `siteId`, which would
 *  order the rows by uuid — see `getMachinesPageService`. */
export const MACHINE_SORT_FIELDS = ["name", "site", "status", "createdAt"] as const;
export type MachineSortField = (typeof MACHINE_SORT_FIELDS)[number];
