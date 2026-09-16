import { z } from "zod/v4";

import { ALERT_TYPES } from "../types/machineAlert";

const ISO_DATE_MESSAGE = { message: "date must be formatted YYYY-MM-DD" };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

export const getAlertsPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
  machineIds: queryArray(z.uuid({ message: "machineIds must be uuids" })),
  siteIds: queryArray(z.uuid({ message: "siteIds must be uuids" })),
  alertTypes: queryArray(z.enum(ALERT_TYPES)),
  dateFrom: z.string().regex(ISO_DATE, ISO_DATE_MESSAGE).optional(),
  dateTo: z.string().regex(ISO_DATE, ISO_DATE_MESSAGE).optional(),
});
