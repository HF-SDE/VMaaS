import { z } from "zod";
import { MachineAlertRow } from "../types";

export const MachineAlertRowSchema = z.object({
  id: z.uuid(),
  type: z.enum(["tamper", "offline", "error"]),
  machineId: z.uuid(),
  machineName: z.string(),
  createdAt: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  message: z.string(),
  siteId: z.uuid(),
  siteName: z.string(),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
}) satisfies z.ZodType<MachineAlertRow>;