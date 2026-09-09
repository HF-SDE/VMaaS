import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { PERMISSIONS } from "@/lib/rbac";

import { Router } from "express";

import { createMachineController, getMachinesController } from "../controllers/machines.controller";

/**
 * Reference implementation for a tenant-scoped, permission-checked resource.
 * Every query is filtered by `req.tenantId` so one tenant can never read or
 * mutate another tenant's rows.
 */
export const machinesRouter = Router();

machinesRouter.use(requireAuth, requireTenant);

machinesRouter.get("/", requirePermission(PERMISSIONS.MACHINE_READ), getMachinesController);
machinesRouter.post("/", requirePermission(PERMISSIONS.MACHINE_WRITE), createMachineController);
