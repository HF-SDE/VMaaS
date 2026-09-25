import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { requireSubscription } from "@/api/middleware/require-subscription";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { getSlotsSchema, updateSlotSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import { getLowStockSlotsController, getSlotsController, updateSlotController } from "../controllers/slots.controller";

export const slotsRouter = Router();

slotsRouter.use(requireAuth, requireTenant, requireSubscription);

/**
 * The machine rides in the query rather than in the path — `GET /api/slots?machineId=…`
 * rather than `GET /api/machines/:id/slots` — so the whole resource stays in one
 * route/controller/service trio instead of being split across the machines router.
 *
 * Reading slots is guarded by MACHINE_READ: a slot is part of the machine it is
 * cut into, and whoever may see the machine may see what is in it. SLOT_MANAGE
 * is what the write costs.
 */
slotsRouter.get("/", requirePermission(PERMISSIONS.MACHINE_READ), validate(getSlotsSchema), getSlotsController);

/**
 * A literal path, so it must stay above "/:id". Guarded by MACHINE_READ for the
 * same reason the list above is: a slot is part of the machine it is cut into.
 */
slotsRouter.get("/low-stock", requirePermission(PERMISSIONS.MACHINE_READ), getLowStockSlotsController);

slotsRouter.patch("/:id", requirePermission(PERMISSIONS.SLOT_MANAGE), validate(updateSlotSchema), updateSlotController);
