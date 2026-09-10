import { Request, Response } from "express";

import { createProductService, getProductsService } from "../services/products.service";

export async function getProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return;
  }

  const response = await getProductsService(tenantId);

  res.status(200).json(response).end();
}

export async function createProductsController(req: Request, res: Response) {
  const { tenantId } = req;
  const { name, price } = req.body as { name?: string; price: number };

  if (!name?.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return;
  }

  const response = await createProductService(tenantId, name.trim(), price);

  res.status(201).json(response).end();
}
