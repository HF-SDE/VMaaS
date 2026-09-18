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
