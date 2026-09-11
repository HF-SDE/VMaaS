import { Request, Response } from "express";

import { createMachineService, getMachinesService } from "../services/machines.service";

export async function getMachinesController(req: Request, res: Response) {
  const { tenantId } = req;

  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return;
  }

  const response = await getMachinesService(tenantId);

  res.status(200).json(response).end();
}

export async function createMachineController(req: Request, res: Response) {
  const { tenantId } = req;
  const { name, location } = req.body as { name: string; location: string };

  const response = await createMachineService(tenantId!, name, location);

  res.status(201).json(response).end();
}
