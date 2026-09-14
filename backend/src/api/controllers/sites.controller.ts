import { createSiteSchema, getSitesPageSchema, siteIdParamsSchema, updateSiteSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";
import { z } from "zod/v4";

import {
  createSiteService,
  deleteSiteService,
  getSiteByIdService,
  getSitesPageService,
  getSitesService,
  updateSiteService,
} from "../services/sites.service";

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
export async function getSitesController(req: Request, res: Response) {
  const { tenantId } = req;

  const [error, sites] = await getSitesService(tenantId!);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the sites" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(sites).end();
}

export async function getSitesPageController(req: Request, res: Response) {
  const { tenantId } = req;

  // This route has no `validate()` middleware — the query is parsed here.
  const { data, error: parseError } = getSitesPageSchema.safeParse(req.query);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, page] = await getSitesPageService(tenantId!, data);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the sites" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(page).end();
}

export async function createSiteController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = createSiteSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, site] = await createSiteService(tenantId!, data.body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while creating the site" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(201).json(site).end();
}

export async function getSiteController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = siteIdParamsSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, site] = await getSiteByIdService(tenantId!, data.params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "SITE_NOT_FOUND":
        return res.status(404).json({ error: "Site not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the site" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(site).end();
}

export async function updateSiteController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = updateSiteSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, site] = await updateSiteService(tenantId!, data.params.id, data.body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "SITE_NOT_FOUND":
        return res.status(404).json({ error: "Site not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while updating the site" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(site).end();
}

export async function deleteSiteController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = siteIdParamsSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error] = await deleteSiteService(tenantId!, data.params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "SITE_IN_USE":
        return res.status(409).json({ error: "Site still has one or more machines" }).end();
      case "SITE_NOT_FOUND":
        return res.status(404).json({ error: "Site not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while deleting the site" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json({ success: true }).end();
}
