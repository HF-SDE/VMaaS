import { commandResultSchema, deviceEventSchema, renewCertificateSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getCertificateAuthority } from "@/lib/ca";
import { prisma } from "@/lib/prisma";

import {
  getDeviceConfigurationService,
  recordCommandResultService,
  recordDeviceEventService,
  renewCertificateService,
} from "../services/device.service";

/**
 * Every controller here reads `req.machine!`, set by `requireMachine` from a
 * verified client certificate, and never a machine, tenant or site id out of
 * the body, query or params. The requests carry no such id to read.
 */

export async function getDeviceConfigurationController(req: Request, res: Response) {
  const [error, configuration] = await getDeviceConfigurationService(prisma, req.machine!);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "CONFIGURATION_NOT_FOUND":
        return res.status(404).json({ error: "No configuration published" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while reading the configuration" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(configuration).end();
}

export async function postCommandResultController(req: Request, res: Response) {
  const { body } = commandResultSchema.parse(req);

  const [error, result] = await recordCommandResultService(prisma, req.machine!, body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "COMMAND_NOT_FOUND":
        return res.status(404).json({ error: "Unknown command" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while recording the result" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(result).end();
}

export async function postDeviceEventController(req: Request, res: Response) {
  const { body } = deviceEventSchema.parse(req);

  const [error, result] = await recordDeviceEventService(prisma, req.machine!, body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while storing the event" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(201).json(result).end();
}

/**
 * Rotation: the current certificate authorises its successor. Signing uses
 * `req.machine!.id`, never the body, so a device cannot mint a certificate for
 * another machine.
 */
export async function renewCertificateController(req: Request, res: Response) {
  const { body } = renewCertificateSchema.parse(req);
  const machine = req.machine!;
  const ca = await getCertificateAuthority();

  const [error, result] = await renewCertificateService(prisma, ca, machine, body.csr);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "CSR_REJECTED":
        return res.status(400).json({ error: "Activation rejected", reason: "CSR_REJECTED" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while rotating the certificate" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(result).end();
}
