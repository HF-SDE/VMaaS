import { Request, Response } from "express";

import { createProductService, getProductsPageService, getProductsService } from "../services/products.service";

/** Query strings arrive as `string | string[] | undefined`; keep only usable scalars. */
function parseNumberParam(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function getProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return;
  }

  const response = await getProductsService(tenantId);

  res.status(200).json(response).end();
}

export async function getProductsPageController(req: Request, res: Response) {
  const { tenantId } = req;
  const { page, pageSize, sortBy, sortOrder, search } = req.query;

  if (!tenantId) {
    res.status(400).json({ error: "tenantId is required" });
    return;
  }

  const response = await getProductsPageService(tenantId, {
    page: parseNumberParam(page),
    pageSize: parseNumberParam(pageSize),
    sortBy: typeof sortBy === "string" ? sortBy : undefined,
    sortOrder: sortOrder === "asc" || sortOrder === "desc" ? sortOrder : undefined,
    search: typeof search === "string" ? search : undefined,
  });

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
