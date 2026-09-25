import type { Request, Response } from "express";

import { recordConnectionEventService } from "@/api/services/connection.service";
import { prisma } from "@/lib/prisma";

/**
 * EMQX's rule-engine HTTP action for `$events/client_connected` and
 * `$events/client_disconnected` (config/emqx/emqx.conf). See
 * connection.service.ts for why this endpoint exists instead of an MQTT Last
 * Will, and for the guards it applies.
 *
 * `occurredAt` is the broker's own `connected_at` / `disconnected_at`
 * (aliased to `at` by the rule's SQL), not the rule's firing time — EMQX's
 * `timestamp` column is wall-clock-at-rule-evaluation, not the connection
 * instant, verified empirically against the live broker with
 * `POST /api/v5/rule_test`. `reason` arrives as `''` rather than absent on a
 * connect, because referencing a column that only exists on the disconnect
 * event renders as the literal string `"undefined"` otherwise, so the rule's
 * SQL substitutes `''`; either way it is optional here.
 *
 * Always answers 200: a broker-side webhook is not a place to fail a
 * connection over, and an unrecognised event, the platform client, an
 * unresolvable clientid, or a malformed body are all normal traffic here,
 * never an error.
 */
export type ConnectionEventBody = {
  clientid?: string;
  event?: string;
  occurredAt?: number;
  reason?: string;
};

function toStatus(event: string | undefined): "online" | "offline" | null {
  if (event === "client.connected") return "online";
  if (event === "client.disconnected") return "offline";
  return null;
}

export async function mqttConnectionController(req: Request, res: Response) {
  try {
    const body = req.body as ConnectionEventBody;
    const status = toStatus(body.event);
    const reason = typeof body.reason === "string" && body.reason.length > 0 ? body.reason : undefined;

    if (status && typeof body.clientid === "string" && typeof body.occurredAt === "number") {
      const [error] = await recordConnectionEventService(prisma, {
        clientId: body.clientid,
        status,
        occurredAt: new Date(body.occurredAt),
        reason,
      });

      // Still answers the broker 200 (see below) — but a database outage
      // dropping status events must leave a trace somewhere, or a sustained
      // one is indistinguishable from every machine actually going quiet.
      if (error) {
        console.error(`[mqtt-connection] ${error.reason}: ${error.message}`);
      }
    }
  } catch {
    // Never let an unexpected failure here reach the broker as anything but
    // 200 — see the module comment.
  }

  res.status(200).json({}).end();
}
