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
export const deviceEventSchema = z.object({
  body: z
    .object({
      type: z.string().trim().min(1, { message: "type is required" }),
      payload: z.record(z.string(), z.unknown()).default({}),
      /** Device-supplied id, for deduplicating a replayed offline queue. */
      eventId: z.string().trim().min(1).max(128).optional(),
      sequenceNumber: z.coerce.number().int().nonnegative().optional(),
      /**
       * Absent when the device had no clock. An ESP32 has no battery-backed
       * RTC, so a cold boot with no network cannot date its own sales — and a
       * coin cannot be rolled back while it waits for one. `uptimeMs` then
       * says how long before this request the sale happened, and the server
       * dates it from receipt. An approximate timestamp is usable; a
       * fabricated 1970 one is worse than none.
       */
      occurredAt: z.iso.datetime().optional(),
      uptimeMs: z.coerce.number().int().nonnegative().optional(),
    })
    .refine((b) => b.occurredAt !== undefined || b.uptimeMs !== undefined, {
      message: "either occurredAt or uptimeMs is required",
    }),
});

/**
 * The payload of a `cash_sale` device event. The device is the only writer, and
 * it is offline-first: the line was formatted on flash possibly days before it
 * arrives, so nothing here may be derived from the time of receipt.
 *
 * `receivedMinor` is what the customer actually put in. It is kept even though
 * nothing sums it yet, because data not captured cannot be reconstructed later
 * while a report can be built whenever someone wants one.
 */
export const cashSalePayloadSchema = z.object({
  slot: z.coerce.number().int().min(1).max(32),
  price_minor: z.coerce.number().int().nonnegative(),
  received_minor: z.coerce.number().int().nonnegative(),
  status: z.enum(["completed", "failed"]),
  reason: z.string().trim().max(64).optional(),
  currency: z.string().trim().length(3).default("DKK"),
});

export type CashSalePayload = z.infer<typeof cashSalePayloadSchema>;

export const renewCertificateSchema = z.object({
  body: z.object({
    csr: z
      .string()
      .trim()
      .startsWith("-----BEGIN CERTIFICATE REQUEST-----", { message: "csr must be a PEM certificate request" })
      .max(8192, { message: "csr is too large" }),
  }),
});
