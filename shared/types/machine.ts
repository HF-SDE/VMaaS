import type { SimpleSite } from "./site";

export interface GetMachinesParams {
  page?: number; // 0-based
  pageSize?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  search?: string;
}

/** What a machine picker sends to `GET /api/machines/simple-search`. `search` is
 *  required: the endpoint exists to answer a typed query, never to list. */
export interface SimpleMachineSearchParams {
  search: string;
  limit?: number;
}

/** The minimum a machine picker needs — the id it submits, plus the site that
 *  tells two machines of the same name apart. */
export interface SimpleMachine {
  id: string;
  name: string;
  site: SimpleSite;
}

export interface MachineUsage {
  canDelete: boolean;
}

/** A machine that has a tenant always has a site — `claimMachineService` and
 *  `createMachineService` both set them in the same write — so the list and
 *  the detail both include the site the UI has to name, rather than leaving
 *  the client to resolve an id. A machine with neither is a different type:
 *  see `MachineWithoutTenant`. */
export interface MachineSite {
  site: SimpleSite;
}

/** A figure over the KPI window beside the same figure over the window
 *  immediately before it, so a card can show a trend without a second request.
 *  The comparison is the reader's to make: nothing here says which way is good. */
export interface MachineKpiTrend {
  current: number;
  previous: number;
}

/**
 * The KPI block `GET /api/machines/:id` returns beside the machine.
 *
 * Every figure is scoped to the one machine. `sales` and `alerts.logged` cover
 * `days` back from now; `stock` and `alerts.open` describe the machine as it
 * stands and have no window to speak of.
 */
export interface MachineKpi {
  /** The window the windowed figures cover, clamped by the service. Echoed back
   *  so a card can label itself rather than hard-coding "30 days". */
  days: number;
  since: Date;
  /** Completed sales only — a pending or failed sale is not money taken. */
  sales: { revenue: MachineKpiTrend; count: MachineKpiTrend };
  stock: { slots: number; quantity: number; capacity: number; emptySlots: number };
  alerts: { open: number; logged: MachineKpiTrend };
  lastSaleAt: Date | null;
}

/** Mixed into the detail read only. The list has no KPIs: they cost eight
 *  queries a machine, which is a page of them for a page of rows. */
export interface MachineKpis {
  kpi: MachineKpi;
}

/** `site` sorts by the site's name rather than by the raw `siteId`, which would
 *  order the rows by uuid — see `getMachinesPageService`. */
export const MACHINE_SORT_FIELDS = ["name", "site", "status", "createdAt"] as const;
export type MachineSortField = (typeof MACHINE_SORT_FIELDS)[number];

/**
 * What the slot layout editor sends to `POST /api/machines/save-slot-layout`.
 *
 * The whole layout, not a list of changes: a slot without an `id` is new, a slot with
 * an `id` is updated, and a stored slot whose `id` is missing has been deleted.
 */
export interface SaveSlotLayoutData {
  machineId: string;
  columns: number;
  rows: number;
  slots: {
    /** Missing for slots created in the editor */
    id?: string;
    slotNumber: number;
    beginX: number;
    endX: number;
    beginY: number;
    endY: number;
    capacity: number;
  }[];
}
