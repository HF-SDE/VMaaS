import { listConfigurationsService, publishConfigurationService } from "@/api/services/configuration.service";

import { machineIdParamsSchema, publishConfigurationSchema } from "@vmaas/shared/schemas";
import type { Request, Response } from "express";

export async function publishConfigurationController(req: Request, res: Response) {
  const { params, body } = publishConfigurationSchema.parse(req);

  // Better Auth populates req.session in requireAuth; the user is session.user,
  // as auth.ts:53 and :85 read it. There is no req.user on this codebase.
  const [error, result] = await publishConfigurationService(params.id, req.session!.user.id, body.fromVersion);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
      case "VERSION_NOT_FOUND":
        return res.status(404).json({ error: error.message }).end();
      case "NO_SLOTS":
      case "SLOTS_NOT_WIRED":
        return res.status(422).json({ error: error.message, slots: error.slots }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while publishing the configuration" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(result).end();
}

export async function listConfigurationsController(req: Request, res: Response) {
  const { params } = machineIdParamsSchema.parse(req);

  const [error, result] = await listConfigurationsService(params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: error.message }).end();
      case "NO_SLOTS":
      case "SLOTS_NOT_WIRED":
      case "VERSION_NOT_FOUND":
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while listing configurations" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(result).end();
}
