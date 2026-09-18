import { z } from "zod/v4";

/**
 * None of these carry a machine, tenant or site id. The machine is implicit in
 * the client certificate, so there is no identifier in the request for a device
 * to tamper with (spec §8).
 */

export const commandResultSchema = z.object({
  body: z.object({
    commandId: z.string().trim().min(1, { message: "commandId is required" }),
    status: z.enum(["completed", "failed"]),
    detail: z.string().trim().max(2000).optional(),
    completedAt: z.iso.datetime().optional(),
  }),
});

export const deviceEventSchema = z.object({
  body: z.object({
    type: z.string().trim().min(1, { message: "type is required" }),
    payload: z.record(z.string(), z.unknown()).default({}),
    /** Device-supplied id, for deduplicating a replayed offline queue. */
    eventId: z.string().trim().min(1).max(128).optional(),
    sequenceNumber: z.coerce.number().int().nonnegative().optional(),
    occurredAt: z.iso.datetime(),
  }),
});

export const renewCertificateSchema = z.object({
  body: z.object({
    csr: z
      .string()
      .trim()
      .startsWith("-----BEGIN CERTIFICATE REQUEST-----", { message: "csr must be a PEM certificate request" })
      .max(8192, { message: "csr is too large" }),
  }),
});
