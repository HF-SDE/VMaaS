/**
 * The alert types `alert_type` declares in the Prisma schema.
 *
 * Spelled out here rather than imported from the generated client: the enum
 * lives behind the `@prisma` alias, which only the frontend's tsconfig defines,
 * so importing it would make this file untypecheckable from the backend. The
 * same reason `MACHINE_SORT_FIELDS` is a `const` array rather than a generated
 * type. `rbac-contract`-style drift is caught by the backend's own test, which
 * asserts this list against the generated enum.
 */
export const ALERT_TYPES = ["tamper", "offline", "error"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * One row of the machine alert log, flattened for the wire.
 *
 * The machine and the site are joined in and reduced to the names the table
 * prints, so the client never resolves an id. The dates are strings, not
 * `Date`: every one of them is JSON by the time a caller sees it, and typing
 * them as `Date` only hides the `new Date(...)` the consumer still has to do.
 */
export interface MachineAlertRow {
  id: string;
  type: AlertType;
  machineId: string;
  machineName: string;
  /** When the row was written. */
  createdAt: string;
  /** When the machine says the alert happened — what the log sorts and filters on. */
  occurredAt: string;
  /** `null` while the alert is still open. */
  resolvedAt: string | null;
  message: string;
  siteId: string;
  siteName: string;
  /** Who to call about the site the machine stands at; either may be unset. */
  contactPhone: string | null;
  contactEmail: string | null;
}

/** How many recent open alerts the dashboard summary carries. The card shows
 *  the first few and hides the rest behind "Show N more", so this is the depth
 *  of that button, not what is on screen; the log is still one click away.
 *  Matches `LOW_STOCK_LIMIT`, the restock queue's equivalent. */
export const ALERTS_SUMMARY_RECENT_LIMIT = 50;

/**
 * What `GET /api/alerts/summary` answers: how bad it is, and the few rows worth
 * showing without opening the log.
 *
 * `recent` is `MachineAlertRow[]` rather than a narrower shape so one alert
 * renders identically whether it came from here or from `/paginated`.
 */
export interface AlertsSummary {
  /** Open alerts only — `resolvedAt` is null. One key per `ALERT_TYPES` member. */
  openByType: Record<AlertType, number>;
  openTotal: number;
  /** At most `ALERTS_SUMMARY_RECENT_LIMIT`, newest first by `occurredAt`. */
  recent: MachineAlertRow[];
}

/**
 * What the alert log sends to `GET /api/alerts/paginated`.
 *
 * Every filter is optional and an empty array means "not filtered", so the
 * unfiltered log is the request with no query at all. The id arrays are
 * intersected with the tenant's own rows by the service, never trusted.
 */
export interface GetAlertsParams {
  page?: number; // 0-based
  pageSize?: number;
  sortOrder?: "asc" | "desc";
  search?: string;
  machineIds?: string[];
  siteIds?: string[];
  alertTypes?: AlertType[];
  /** Inclusive ISO date (`YYYY-MM-DD`) bounds on `occurredAt`. */
  dateFrom?: string;
  dateTo?: string;
}
