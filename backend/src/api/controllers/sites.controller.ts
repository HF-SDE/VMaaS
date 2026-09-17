import {
  createSiteSchema,
  getSitesPageSchema,
  simpleSiteSearchSchema,
  siteIdParamsSchema,
  updateSiteSchema,
} from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import {
  createSiteService,
  deleteSiteService,
  getSiteByIdService,
  getSitesPageService,
  getSitesService,
  simpleSiteSearchService,
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
 *
 * That parse throws rather than answering 400 itself. The router's
 * `validate(schema)` middleware has already rejected a malformed request
 * against the same schema, so a throw here means the two disagree — a bug, not
 * bad input, and it belongs in the error handler rather than in a 400 the
 * client can do nothing with.
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

  const { query } = getSitesPageSchema.parse(req);

  const [error, page] = await getSitesPageService(tenantId!, query);

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

/**
 * The site picker's endpoint: a handful of matches for what the user typed.
 *
 * A missing or blank `search` is a 400 from `validate()` — an empty query would
 * list the tenant's sites, which is what `GET /api/sites` is for.
 */
export async function simpleSiteSearchController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = simpleSiteSearchSchema.parse(req);

  const [error, sites] = await simpleSiteSearchService(tenantId!, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while searching the sites" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(sites).end();
}

export async function createSiteController(req: Request, res: Response) {
  const { tenantId } = req;

  const { body } = createSiteSchema.parse(req);

  const [error, site] = await createSiteService(tenantId!, body);

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

  const { params } = siteIdParamsSchema.parse(req);

  const [error, site] = await getSiteByIdService(tenantId!, params.id);

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

  const { params, body } = updateSiteSchema.parse(req);

  const [error, site] = await updateSiteService(tenantId!, params.id, body);

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

  const { params } = siteIdParamsSchema.parse(req);

  const [error] = await deleteSiteService(tenantId!, params.id);

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
