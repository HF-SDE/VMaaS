import { z } from "zod/v4";

/**
 * None of these carry a machine, tenant or site id. The machine is implicit in
 * the client certificate.
 */

export const commandResultSchema = z.object({
  body: z.object({
    commandId: z.string().trim().min(1, { message: "commandId is required" }),
    status: z.enum(["completed", "failed"]),
    detail: z.string().trim().max(2000).optional(),
    completedAt: z.iso.datetime().optional(),
  }),
});

/**
 * One event as a machine reports it. Shared by the single and batch endpoints
 * so the two cannot drift: a record the device may send in a batch is exactly
 * a record it may send on its own, which is what makes the sender's fallback
 * from a rejected batch to single posts safe.
 */
const deviceEventBody = z.object({
  // 64 matches the firmware's MAX_TYPE (32, including the NUL) with room to
  // spare — the journal itself already refuses anything that would not fit.
  type: z.string().trim().min(1, { message: "type is required" }).max(64, { message: "type is too long" }),
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Device-supplied id, for deduplicating a replayed offline queue. */
  eventId: z.string().trim().min(1).max(128).optional(),
  sequenceNumber: z.coerce.number().int().nonnegative().optional(),
  occurredAt: z.iso.datetime(),
});

export const deviceEventSchema = z.object({ body: deviceEventBody });

/**
 * A machine draining its offline journal. Capped at 50 because the batch is
 * stored in one statement and `express.json()` takes 100 KB by default; a
 * device that wants to send more sends more batches.
 */
export const deviceEventBatchSchema = z.object({
  body: z.object({
    events: z.array(deviceEventBody).min(1, { message: "events must not be empty" }).max(50),
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
