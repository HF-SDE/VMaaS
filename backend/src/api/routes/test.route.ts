import { broadcast } from "@/lib/ws/server";

import { WsAlertCreatedMessage } from "@vmaas/shared/schemas";
import { Router } from "express";

import { requireAuth, requireTenant } from "../middleware/auth";

export const testRouter = Router();

testRouter.get("/ping", (_req, res) => res.status(200).json({ message: "pong" }));

testRouter.get("/send-alert", requireAuth, requireTenant, (req, res) => {
  const tenantId = req.tenantId!;

  const message: WsAlertCreatedMessage = {
    type: "alert.created",
    body: {
      id: "00000000-0000-0000-0000-000000000000",
      type: "tamper",
      machineId: "00000000-0000-0000-0000-000000000000",
      machineName: "Test Machine",
      createdAt: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      resolvedAt: null,
      message: "Test alert message",
      siteId: "00000000-0000-0000-0000-000000000000",
      siteName: "Test Site",
      contactPhone: null,
      contactEmail: null,
    },
  };

  broadcast(tenantId, message);

  res.status(200).json({ status: "Alert sent", message });
});
