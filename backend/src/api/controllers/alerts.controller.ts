import { getAlertsPageSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";
import { z } from "zod/v4";

import { getAlertsPageService } from "../services/alerts.service";

/**
 * One page of the tenant's machine alert log.
 *
 * Like the other paginated reads, the query is parsed here rather than by
 * `validate()` middleware, so this reads `req.query` directly. The tenant comes
 * from `req.tenantId` — set by `requireTenant` after it verified membership —
 * and never from the query, which only ever narrows within it.
 */
export async function getAlertsPageController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = getAlertsPageSchema.safeParse(req.query);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, page] = await getAlertsPageService(tenantId!, data);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the alerts" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(page).end();
}
