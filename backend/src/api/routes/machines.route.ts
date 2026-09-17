import { requireAuth, requirePermission, requireSuperAdmin, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import {
  createMachineSchema,
  getMachinesPageSchema,
  machineIdParamsSchema,
  saveSlotLayoutSchema,
  simpleMachineSearchSchema,
  updateMachineSchema,
} from "@vmaas/shared/schemas";
import { Router } from "express";

import {
  createMachineController,
  deleteMachineController,
  getMachineController,
  getMachineWithoutTenantController,
  getMachinesController,
  getMachinesPageController,
  getMachinesWithoutTenantController,
  saveSlotLayoutController,
  simpleMachineSearchController,
  updateMachineController,
} from "../controllers/machines.controller";

export const machinesRouter = Router();

machinesRouter.get("/without-tenant", requireAuth, requireSuperAdmin, getMachinesWithoutTenantController);
machinesRouter.get(
  "/without-tenant/:id",
  requireAuth,
  requireSuperAdmin,
  validate(machineIdParamsSchema),
  getMachineWithoutTenantController,
);
machinesRouter.post(
  "/save-slot-layout",
  requireAuth,
  requireSuperAdmin,
  validate(saveSlotLayoutSchema),
  saveSlotLayoutController,
);

machinesRouter.use(requireAuth, requireTenant);

machinesRouter.get("/", requirePermission(PERMISSIONS.MACHINE_READ), getMachinesController);
// Must stay above "/:id", which would otherwise match "paginated" as an id.
machinesRouter.get(
  "/paginated",
  requirePermission(PERMISSIONS.MACHINE_READ),
  validate(getMachinesPageSchema),
  getMachinesPageController,
);
// Same: a literal path above "/:id". Feeds the machine picker.
machinesRouter.get(
  "/simple-search",
  requirePermission(PERMISSIONS.MACHINE_READ),
  validate(simpleMachineSearchSchema),
  simpleMachineSearchController,
);
machinesRouter.post(
  "/",
  requirePermission(PERMISSIONS.MACHINE_WRITE),
  validate(createMachineSchema),
  createMachineController,
);

machinesRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.MACHINE_READ),
  validate(machineIdParamsSchema),
  getMachineController,
);
machinesRouter.patch(
  "/:id",
  requirePermission(PERMISSIONS.MACHINE_WRITE),
  validate(updateMachineSchema),
  updateMachineController,
);
machinesRouter.delete(
  "/:id",
  requirePermission(PERMISSIONS.MACHINE_WRITE),
  validate(machineIdParamsSchema),
  deleteMachineController,
);
