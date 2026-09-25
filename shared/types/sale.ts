/** How far back `GET /api/sales/map` looks when the request doesn't say. */
export const DEFAULT_SALES_MAP_DAYS = 30;

/** A year. Past this the map is a history lesson, not an operational view, and
 *  the payload is one point per sale. */
export const MAX_SALES_MAP_DAYS = 365;

/** Query for `GET /api/sales/map`. Clamped by the service rather than
 *  rejected, so a hand-edited `?days=99999` still renders a year. */
export interface GetSalesMapParams {
  days?: number;
}

/**
 * One completed sale, positioned at the site its machine stands in.
 *
 * Sales are deliberately not aggregated per site: five sales in one canteen are
 * five points sharing a coordinate, which is what lets the map cluster them and
 * add their prices up.
 */
export interface SaleMapPoint {
  id: string;
  price: number;
  /** ISO 8601. A `Date` would be a lie on the client, which only ever sees the
   *  serialised string. */
  createdAt: string;
  /** Null once the product behind the sale has been deleted. */
  productName: string | null;
  machineId: string;
  machineName: string;
  siteId: string;
  siteName: string;
  latitude: number;
  longitude: number;
}

/** The window the dashboard's chart and its widest tile both cover. */
export const DEFAULT_SALES_SUMMARY_DAYS = 30;
/** A quarter. Past this the card is a report, not an overview. */
export const MAX_SALES_SUMMARY_DAYS = 90;

export interface GetSalesSummaryParams {
  days?: number;
}

export interface SalesTotals {
  revenue: number;
  count: number;
}

/** One UTC day. Present even when nothing sold, so the chart cannot compress a
 *  dead weekend into a straight line between the days on either side. */
export interface SalesDayPoint {
  /** `YYYY-MM-DD`, UTC. */
  date: string;
  revenue: number;
  count: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  count: number;
  revenue: number;
}

/**
 * What `GET /api/sales/summary` answers.
 *
 * Every figure counts `completed` sales only: `pending` is not money yet,
 * `failed` is not money, and `refunded` is money given back. Counting any of
 * them would overstate the tiles.
 */
export interface SalesSummary {
  today: SalesTotals;
  last7Days: SalesTotals;
  last30Days: SalesTotals;
  /** One entry per day in the window, oldest first. */
  daily: SalesDayPoint[];
  /** At most 5, descending by revenue. */
  topProducts: TopProduct[];
}
