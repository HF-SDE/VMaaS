import { getSalesMapSchema, getSalesSummarySchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getSalesMapService, getSalesService, getSalesSummaryService } from "../services/sales.service";

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

export async function getSalesSummaryController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = getSalesSummarySchema.parse(req);

  const [error, summary] = await getSalesSummaryService(tenantId!, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the sales summary" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(summary).end();
}
