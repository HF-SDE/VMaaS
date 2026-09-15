import {
  createProductSchema,
  getProductsPageSchema,
  productIdParamsSchema,
  updateProductSchema,
} from "@vmaas/shared/schemas";
import { Request, Response } from "express";
import { z } from "zod/v4";

import {
  createProductService,
  deleteProductService,
  getProductByIdService,
  getProductsPageService,
  getProductsService,
  setProductArchivedService,
  updateProductService,
} from "../services/products.service";

/**
 * Every controller destructures the service's `Result` tuple and switches on
 * the failure's `reason`. The `satisfies never` in each default arm is what
 * makes it exhaustive: adding a reason to a service stops compiling until the
 * status code and the wording for it are decided here.
 *
 * Params and bodies reach the services through a schema parse of the request
 * rather than a cast: Express types a route param as `string | string[]`, so
 * the parse is what turns `req.params.id` into the uuid string a service takes.
 */
export async function getProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  const [error, products] = await getProductsService(tenantId!);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the products" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(products).end();
}

export async function getProductsPageController(req: Request, res: Response) {
  const { tenantId } = req;

  // This route has no `validate()` middleware — the query is parsed here.
  const { data, error: parseError } = getProductsPageSchema.safeParse(req.query);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, page] = await getProductsPageService(tenantId!, data);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the products" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(page).end();
}

export async function createProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = createProductSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const { name, price } = data.body;
  const [error, product] = await createProductService(tenantId!, name, price);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while creating the product" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(201).json(product).end();
}

export async function getProductController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = productIdParamsSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, product] = await getProductByIdService(tenantId!, data.params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "PRODUCT_NOT_FOUND":
        return res.status(404).json({ error: "Product not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the product" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(product).end();
}

export async function updateProductController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = updateProductSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, product] = await updateProductService(tenantId!, data.params.id, data.body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "PRODUCT_NOT_FOUND":
        return res.status(404).json({ error: "Product not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while updating the product" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(product).end();
}

/** Shared by the archive and unarchive routes — they differ only in the flag. */
function archiveController(archived: boolean) {
  const action = archived ? "archiving" : "unarchiving";

  return async (req: Request, res: Response) => {
    const { tenantId } = req;

    const { data, error: parseError } = productIdParamsSchema.safeParse(req);
    if (parseError)
      return res
        .status(400)
        .json({ error: z.treeifyError(parseError) })
        .end();

    const [error, product] = await setProductArchivedService(tenantId!, data.params.id, archived);

    if (error) {
      const reason = error.reason;
      switch (reason) {
        case "PRODUCT_NOT_FOUND":
          return res.status(404).json({ error: "Product not found" }).end();
        case "UNKNOWN_ERROR":
          return res
            .status(500)
            .json({ error: `An unknown error occurred while ${action} the product` })
            .end();
        default:
          throw new Error(`Unhandled error reason ${reason satisfies never}`);
      }
    }

    return res.status(200).json(product).end();
  };
}

export const archiveProductController = archiveController(true);
export const unarchiveProductController = archiveController(false);

export async function deleteProductController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = productIdParamsSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error] = await deleteProductService(tenantId!, data.params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "PRODUCT_IN_USE":
        return res.status(409).json({ error: "Product is used by one or more slots" }).end();
      case "PRODUCT_NOT_FOUND":
        return res.status(404).json({ error: "Product not found" }).end();
      case "PRODUCT_REFERENCED":
        return res.status(409).json({ error: "Product is referenced by other data" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while deleting the product" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json({ success: true }).end();
}
