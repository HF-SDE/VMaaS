import { activateMachineSchema, claimMachineSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getCertificateAuthority } from "@/lib/ca";
import { prisma } from "@/lib/prisma";

import { activateMachineService, claimMachineService } from "../services/activation.service";

/**
 * Params and bodies reach the services through a schema parse of the request
 * rather than a cast, matching the pattern in sites.controller.ts. The
 * router's `validate(schema)` middleware has already rejected a malformed
 * request against the same schema, so a throw here means the two disagree —
 * a bug, not bad input.
 */

/** `POST /api/machines/claim` — the administrator's half of phase 1. */
export async function claimMachineController(req: Request, res: Response) {
  const { body } = claimMachineSchema.parse(req);

  const [error, result] = await claimMachineService(prisma, {
    tenantId: req.tenantId!,
    siteId: body.siteId,
    serialNumber: body.serialNumber,
    userId: req.session!.user.id,
  });

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "No machine has that serial number" }).end();
      case "MACHINE_ALREADY_CLAIMED":
        return res.status(409).json({ error: "The machine is already claimed" }).end();
      case "SITE_NOT_FOUND":
        return res.status(404).json({ error: "The site does not exist for this tenant" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while claiming the machine" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  // The code is in this response and nowhere else: only its hash is stored.
  return res.status(201).json(result).end();
}

/** `POST /api/device/activate` — called by the machine. No session. */
export async function activateMachineController(req: Request, res: Response) {
  const { body } = activateMachineSchema.parse(req);
  const ca = await getCertificateAuthority();

  const [error, data] = await activateMachineService(prisma, ca, body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      // Every rejection answers 400 with the same shape. A device cannot act on
      // the difference, and a finer answer would tell a prober which machine
      // ids and codes exist.
      case "ACTIVATION_CODE_INVALID":
      case "ACTIVATION_EXPIRED":
      case "ACTIVATION_ATTEMPTS_EXCEEDED":
      case "CSR_REJECTED":
      case "ACTIVATION_COMMIT_FAILED":
      case "MACHINE_DISABLED":
        return res.status(400).json({ error: "Activation rejected" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while activating" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(data).end();
}
