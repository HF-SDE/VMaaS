import { getAlertsPageSchema, resolveAlertSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getAlertsPageService, getAlertsSummaryService, resolveAlertService } from "../services/alerts.service";

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

export async function getAlertsSummaryController(req: Request, res: Response) {
  const { tenantId } = req;

  const [error, summary] = await getAlertsSummaryService(tenantId!);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the alert summary" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(summary).end();
}

export async function resolveAlertController(req: Request, res: Response) {
  const { tenantId } = req;

  const { params } = resolveAlertSchema.parse(req);

  const [error, alert] = await resolveAlertService(tenantId!, params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "ALERT_NOT_FOUND":
        return res.status(404).json({ error: "Alert not found" }).end();
      case "ALERT_ALREADY_RESOLVED":
        return res.status(409).json({ error: "That alert has already been resolved" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while resolving the alert" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(alert).end();
}
