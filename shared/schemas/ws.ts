import { z } from "zod/v4";

/**
 * Everything the backend pushes over the socket. A discriminated union keeps
 * the contract in one place for both sides: the backend builds values of this
 * type, the browser parses incoming frames with it, so an unknown or malformed
 * event is a parse failure on the client rather than an undefined field.
 *
 * Add new events as members here — that is the only place a new event type
 * needs to be declared.
 */
export const wsServerMessageSchema = z.discriminatedUnion("type", [
  /** Sent once, right after the socket is accepted, naming the tenant it is scoped to. */
  z.object({
    type: z.literal("connected"),
    tenantId: z.uuid(),
  }),
  z.object({
    type: z.literal("alert.created"),
    alertId: z.uuid(),
    machineId: z.uuid(),
  }),
]);

export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
