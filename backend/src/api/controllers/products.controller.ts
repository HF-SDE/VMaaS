import {
  createProductSchema,
  getProductsPageSchema,
  productIdParamsSchema,
  simpleProductSearchSchema,
  updateProductSchema,
} from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { prisma } from "@/lib/prisma";
import { broadcast } from "@/lib/ws/server";

import {
  createProductService,
  deleteProductService,
  getProductByIdService,
  getProductsPageService,
  getProductsService,
  setProductArchivedService,
  simpleProductSearchService,
  updateProductService,
} from "../services/products.service";
import { publishSlotStateForProductService } from "../services/configuration.service";
import { watchSentPriceCommands } from "../services/configuration-sync.service";

/**
 * Every controller destructures the service's `Result` tuple and switches on
 * the failure's `reason`. The `satisfies never` in each default arm is what
 * makes it exhaustive: adding a reason to a service stops compiling until the
 * status code and the wording for it are decided here.
 *
 * Params and bodies reach the services through a schema parse of the request
 * rather than a cast: Express types a route param as `string | string[]`, so
 * the parse is what turns `req.params.id` into the uuid string a service takes.
 *
 * That parse throws rather than answering 400 itself. The router's
 * `validate(schema)` middleware has already rejected a malformed request
 * against the same schema, so a throw here means the two disagree — a bug, not
 * bad input, and it belongs in the error handler rather than in a 400 the
 * client can do nothing with.
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

  const { query } = getProductsPageSchema.parse(req);

  const [error, page] = await getProductsPageService(tenantId!, query);

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

export async function simpleProductSearchController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = simpleProductSearchSchema.parse(req);

  const [error, products] = await simpleProductSearchService(tenantId!, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while searching the products" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(products).end();
}

export async function createProductsController(req: Request, res: Response) {
  const { tenantId } = req;

  const { body } = createProductSchema.parse(req);

  const { name, price } = body;
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

  const { params } = productIdParamsSchema.parse(req);

  const [error, product] = await getProductByIdService(tenantId!, params.id);

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

  const { params, body } = updateProductSchema.parse(req);

  const [error, product] = await updateProductService(tenantId!, params.id, body);

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

  // Every machine selling this product at the product's price follows it;
  // `publish` tells the admin which ones did.
  const publish =
    body.price !== undefined
      ? await publishSlotStateForProductService(tenantId!, params.id, req.session?.user.id ?? null)
      : [];
  watchSentPriceCommands(prisma, broadcast, tenantId!, publish);

  return res.status(200).json({ ...product, publish }).end();
}

/** Shared by the archive and unarchive routes — they differ only in the flag. */
function archiveController(archived: boolean) {
  const action = archived ? "archiving" : "unarchiving";

  return async (req: Request, res: Response) => {
    const { tenantId } = req;

    const { params } = productIdParamsSchema.parse(req);

    const [error, product] = await setProductArchivedService(tenantId!, params.id, archived);

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

  const { params } = productIdParamsSchema.parse(req);

  const [error] = await deleteProductService(tenantId!, params.id);

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
