import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { createMachineSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import { createMachineController, getMachinesController } from "../controllers/machines.controller";
import { validate } from "../middleware/validate";

export const machinesRouter = Router();

machinesRouter.use(requireAuth, requireTenant);

machinesRouter.get("/", requirePermission(PERMISSIONS.MACHINE_READ), getMachinesController);
machinesRouter.post(
  "/",
  requirePermission(PERMISSIONS.MACHINE_WRITE),
  validate(createMachineSchema),
  createMachineController,
);
