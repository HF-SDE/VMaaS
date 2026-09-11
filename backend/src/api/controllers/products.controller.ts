import { Request, Response } from "express";

import { createProductService, getProductsService } from "../services/products.service";

export async function getProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  const response = await getProductsService(tenantId!);

  res.status(200).json(response).end();
}

export async function createProductsController(req: Request, res: Response) {
  const { tenantId } = req;
  const { name, price } = req.body as { name: string; price: number };

  const response = await createProductService(tenantId!, name, price);

  res.status(201).json(response).end();
}
