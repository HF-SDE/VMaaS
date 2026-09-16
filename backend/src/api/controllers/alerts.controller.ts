import { getAlertsPageSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getAlertsPageService } from "../services/alerts.service";

/**
 * One page of the tenant's machine alert log.
 *
 * The tenant comes from `req.tenantId` — set by `requireTenant` after it
 * verified membership — and never from the query, which only ever narrows
 * within it.
 *
 * The parse throws rather than answering 400 itself: the router's
 * `validate(getAlertsPageSchema)` has already rejected a malformed query
 * against the same schema, so a throw here means the two disagree — a bug, not
 * bad input.
 */
export async function getAlertsPageController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = getAlertsPageSchema.parse(req);

  const [error, page] = await getAlertsPageService(tenantId!, query);

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
