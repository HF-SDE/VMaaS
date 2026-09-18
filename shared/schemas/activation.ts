import { z } from "zod/v4";

/** `POST /api/machines/claim`. The site is the diagram's `locationId`. */
export const claimMachineSchema = z.object({
  body: z.object({
    serialNumber: z.string().trim().min(1, { message: "serial number is required" }),
    siteId: z.uuid({ message: "site is required" }),
  }),
});

/** `POST /api/machines/:id/disable`. A reason is required: the point of the
 *  field is that it is obvious why a machine was taken out of service. */
export const disableMachineSchema = z.object({
  params: z.object({ id: z.uuid({ message: "id must be a uuid" }) }),
  body: z.object({
    reason: z.string().trim().min(1, { message: "reason is required" }),
    revokeCertificate: z.boolean().default(false),
  }),
});

/** `POST /api/device/activate`. Called by the machine, not by a browser. */
export const activateMachineSchema = z.object({
  body: z.object({
    machineId: z.uuid({ message: "machineId must be a uuid" }),
    code: z
      .string()
      .trim()
      .min(1, { message: "code is required" })
      .max(64, { message: "code is too long" }),
    csr: z
      .string()
      .trim()
      .startsWith("-----BEGIN CERTIFICATE REQUEST-----", { message: "csr must be a PEM certificate request" })
      .max(8192, { message: "csr is too large" }),
  }),
});
