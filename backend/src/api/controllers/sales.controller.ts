import { getSalesMapSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getSalesMapService, getSalesService } from "../services/sales.service";

export async function getSalesController(req: Request, res: Response) {
  const { tenantId } = req;

  const sales = await getSalesService(tenantId!);

  return res.status(200).json(sales).end();
}

export async function getSalesMapController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = getSalesMapSchema.parse(req);

  const [error, points] = await getSalesMapService(tenantId!, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the sales map" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(points).end();
}
