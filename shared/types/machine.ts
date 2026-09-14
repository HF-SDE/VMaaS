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

export const MACHINE_SORT_FIELDS = ["name", "location", "status", "createdAt"] as const;
export type MachineSortField = (typeof MACHINE_SORT_FIELDS)[number];
