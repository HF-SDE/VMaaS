import { createProductSchema, getProductsPageSchema } from "@vmaas/shared/schemas";
import { APIError } from "better-auth";
import { Request, Response } from "express";
import { z } from "zod/v4";

import { createProductService, getProductsPageService, getProductsService } from "../services/products.service";

export async function getProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  const response = await getProductsService(tenantId!);

  res.status(200).json(response).end();
}

export async function getProductsPageController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error } = getProductsPageSchema.safeParse(req.query);
  if (error) throw new APIError("BAD_REQUEST", z.treeifyError(error));

  const response = await getProductsPageService(tenantId!, data);

  res.status(200).json(response).end();
}

export async function createProductsController(req: Request, res: Response) {
  const { tenantId } = req;
  const { data, error } = createProductSchema.safeParse(req);
  if (error) throw new APIError("BAD_REQUEST", z.treeifyError(error));

  const { name, price } = data.body;
  const response = await createProductService(tenantId!, name, price);

  res.status(201).json(response).end();
}
