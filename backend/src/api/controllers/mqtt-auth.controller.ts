import type { NextFunction, Request, Response } from "express";

import { type MachineLookupDb, resolveMachineCertificate } from "@/api/middleware/require-machine";
import { config } from "@/lib/config";
import { parseSubject } from "@/lib/pki";
import { prisma } from "@/lib/prisma";
import { type MqttAction, authorizeTopic } from "@/mqtt/acl";

/**
 * EMQX's HTTP authentication and authorization sources. The mTLS listener has
 * already proved the peer holds a key for a certificate this CA issued; these
 * decide whether that identity is still allowed, and what it may touch.
 *
 * Both answer 200 with {"result": "allow" | "deny"}. EMQX treats any other
 * status as "ignore" and falls through to `no_match = deny`, so a backend
 * error refuses the connection rather than admitting it.
 */

type Decision = "allow" | "deny";

export type AuthnBody = { clientid?: string; cert_subject?: string };
export type AuthzBody = AuthnBody & { action?: string; topic?: string };

/**
 * Resolves the peer certificate's subject to a live machine, the same way
 * `requireMachine` does on the HTTP side. A certificate that CA-signed but
 * has no (or no longer has a live) `MachineCertificate` row is inert: this
 * row lookup IS the authentication, not the broker's TLS chain check.
 */
async function identify(db: MachineLookupDb, body: AuthnBody) {
  const { machineId, serial } = parseSubject(body.cert_subject ?? "");
  if (!machineId || !serial) return null;

  // The MQTT client id is pinned to the common name. Without this a machine
  // could take another machine's session name, and the kick in the disable
  // path would target the wrong client.
  if (body.clientid !== machineId) return null;

  return resolveMachineCertificate(db, serial.toLowerCase());
}

export async function decideAuthn(db: MachineLookupDb, body: AuthnBody): Promise<Decision> {
  return (await identify(db, body)) ? "allow" : "deny";
}

export async function decideAuthz(db: MachineLookupDb, body: AuthzBody): Promise<Decision> {
  if (body.action !== "publish" && body.action !== "subscribe") return "deny";
  if (typeof body.topic !== "string") return "deny";

  const machine = await identify(db, body);
  if (!machine) return "deny";

  return authorizeTopic(machine, body.action as MqttAction, body.topic) ? "allow" : "deny";
}

/** EMQX reaches the backend on the internal network; the secret is defence in depth. */
export function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  if (req.headers["x-internal-secret"] !== config.MQTT_INTERNAL_SECRET) {
    res.status(401).json({ result: "deny" });
    return;
  }
  next();
}

export async function mqttAuthnController(req: Request, res: Response) {
  const result = await decideAuthn(prisma, req.body as AuthnBody);
  return res.status(200).json({ result }).end();
}

export async function mqttAuthzController(req: Request, res: Response) {
  const result = await decideAuthz(prisma, req.body as AuthzBody);
  return res.status(200).json({ result }).end();
}
