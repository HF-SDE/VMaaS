import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { getSlotsSchema, updateSlotSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import { getSlotsController, updateSlotController } from "../controllers/slots.controller";

export const slotsRouter = Router();

slotsRouter.use(requireAuth, requireTenant);

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

slotsRouter.patch("/:id", requirePermission(PERMISSIONS.SLOT_MANAGE), validate(updateSlotSchema), updateSlotController);
