import { Request, Response } from "express";

import { getSalesService } from "../services/sales.service";

export async function getSalesController(req: Request, res: Response) {
  const { tenantId } = req;

  const sales = await getSalesService(tenantId!);

  return res.status(200).json(sales).end();
}
