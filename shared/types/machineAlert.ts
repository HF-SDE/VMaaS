export const ALERT_TYPES = ["tamper", "offline", "error"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

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

export const ALERTS_SUMMARY_RECENT_LIMIT = 50;
export interface AlertsSummary {
  /** Open alerts only — `resolvedAt` is null. One key per `ALERT_TYPES` member. */
  openByType: Record<AlertType, number>;
  openTotal: number;
  /** At most `ALERTS_SUMMARY_RECENT_LIMIT`, newest first by `occurredAt`. */
  recent: MachineAlertRow[];
}

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
