import { z } from "zod/v4";

import { ALERT_TYPES } from "../types/machineAlert";

const ISO_DATE_MESSAGE = { message: "date must be formatted YYYY-MM-DD" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A repeatable, comma-separatable filter param: `?siteIds=a,b&siteIds=c`.
 *
 * It has to survive being parsed twice — `validate()` leaves its output on the
 * request and the controller parses that again — so the `string[]` it returns
 * is deliberately also valid input. That holds because none of the item types
 * here (uuids, alert-type enums) can contain a comma to be re-split on.
 */
function queryArray<T extends z.ZodType<unknown, string>>(item: T) {
  return z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;

      const parts = (Array.isArray(value) ? value : [value]).flatMap((entry) => entry.split(","));
      const cleaned = parts.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

      return cleaned.length > 0 ? cleaned : undefined;
    })
    .pipe(z.array(item).optional());
}

/**
 * Request-shaped so it can run through `validate()`, which is what makes a
 * malformed filter a 400 rather than a throw out of the controller. Every field
 * stays optional — a bare `/paginated` is a valid request — and the service is
 * what clamps and whitelists the values it gets.
 */
export const getAlertsPageSchema = z.object({
  query: z.object({
    page: z.coerce.number().optional(),
    pageSize: z.coerce.number().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional(),
    search: z.string().optional(),
    machineIds: queryArray(z.uuid({ message: "machineIds must be uuids" })),
    siteIds: queryArray(z.uuid({ message: "siteIds must be uuids" })),
    alertTypes: queryArray(z.enum(ALERT_TYPES)),
    dateFrom: z.string().regex(ISO_DATE, ISO_DATE_MESSAGE).optional(),
    dateTo: z.string().regex(ISO_DATE, ISO_DATE_MESSAGE).optional(),
  }),
});
