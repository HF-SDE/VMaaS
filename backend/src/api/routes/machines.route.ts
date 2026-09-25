import { requireAuth, requirePermission, requireSuperAdmin, requireTenant } from "@/api/middleware/auth";
import { requireSubscription } from "@/api/middleware/require-subscription";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import {
  claimMachineSchema,
  createMachineSchema,
  disableMachineSchema,
  getMachineSchema,
  getMachinesPageSchema,
  machineIdParamsSchema,
  publishConfigurationSchema,
  saveSlotLayoutSchema,
  simpleMachineSearchSchema,
  updateMachineSchema,
} from "@vmaas/shared/schemas";
import { Router } from "express";

import { claimMachineController } from "../controllers/activation.controller";
import { listConfigurationsController, publishConfigurationController } from "../controllers/configuration.controller";
import {
  createMachineController,
  deleteMachineController,
  disableMachineController,
  getMachineController,
  getMachineForLayoutController,
  getMachinesController,
  getMachinesPageController,
  getMachinesWithoutTenantController,
  saveSlotLayoutController,
  simpleMachineSearchController,
  updateMachineController,
} from "../controllers/machines.controller";

export const machinesRouter = Router();

machinesRouter.get("/without-tenant", requireAuth, requireSuperAdmin, getMachinesWithoutTenantController);
machinesRouter.post(
  "/save-slot-layout",
  requireAuth,
  requireSuperAdmin,
  validate(saveSlotLayoutSchema),
  saveSlotLayoutController,
);
machinesRouter.post("/", requireAuth, requireSuperAdmin, validate(createMachineSchema), createMachineController);
machinesRouter.post( "/:id/publish-configuration", requireAuth, requireSuperAdmin, validate(publishConfigurationSchema), publishConfigurationController );
machinesRouter.get( "/:id/configurations", requireAuth, requireSuperAdmin, validate(machineIdParamsSchema), listConfigurationsController);
machinesRouter.get( "/:id/layout", requireAuth, requireSuperAdmin, validate(machineIdParamsSchema), getMachineForLayoutController);

machinesRouter.use(requireAuth, requireTenant, requireSubscription);

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
// Same: a literal path above "/:id". The administrator's half of activation.
machinesRouter.post(
  "/claim",
  requirePermission(PERMISSIONS.MACHINE_WRITE),
  validate(claimMachineSchema),
  claimMachineController,
);

machinesRouter.get(
  "/:id",
  requirePermission(PERMISSIONS.MACHINE_READ),
  validate(getMachineSchema),
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
machinesRouter.post(
  "/:id/disable",
  requirePermission(PERMISSIONS.MACHINE_WRITE),
  validate(disableMachineSchema),
  disableMachineController,
);
