import { createMachineSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { createMachineService, getMachinesService } from "../services/machines.service";

export async function getMachinesController(req: Request, res: Response) {
  const { tenantId } = req;

  const response = await getMachinesService(tenantId!);

  res.status(200).json(response).end();
}

export async function createMachineController(req: Request, res: Response) {
  const { tenantId, body } = createMachineSchema.parse(req);

  const response = await createMachineService(tenantId, body.name, body.location);

  res.status(201).json(response).end();
}
