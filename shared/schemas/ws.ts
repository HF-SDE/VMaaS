import { z } from "zod/v4";

import { MachineAlertRowSchema } from "./machineAlerts";

const wsConnectedSchema = z.object({
  type: z.literal("connected"),
  tenantId: z.uuid(),
});

const wsAlertCreatedSchema = z.object({
  type: z.literal("alert.created"),
  body: MachineAlertRowSchema,
});

/**
 * Everything the backend pushes over the socket. A discriminated union keeps
 * the contract in one place for both sides: the backend builds values of this
 * type, the browser parses incoming frames with it, so an unknown or malformed
 * event is a parse failure on the client rather than an undefined field.
 *
 * Add new events as members here — that is the only place a new event type
 * needs to be declared.
 */
export const wsServerMessageSchema = z.discriminatedUnion("type", [wsConnectedSchema, wsAlertCreatedSchema]);

export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
export type WsAlertCreatedMessage = z.infer<typeof wsAlertCreatedSchema>;
export type WsConnectedMessage = z.infer<typeof wsConnectedSchema>;
