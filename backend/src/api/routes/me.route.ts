import { updateUserSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import { updateUserController } from "../controllers/me.controller";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/validate";

export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.put("/", validate(updateUserSchema), updateUserController);
