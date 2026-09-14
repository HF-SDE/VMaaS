import { requireAuth, requirePermission, requireTenant } from "@/api/middleware/auth";
import { validate } from "@/api/middleware/validate";
import { PERMISSIONS } from "@/lib/rbac";

import { createSiteSchema, siteIdParamsSchema, updateSiteSchema } from "@vmaas/shared/schemas";
import { Router } from "express";

import {
  createSiteController,
  deleteSiteController,
  getSiteController,
  getSitesController,
  getSitesPageController,
  updateSiteController,
} from "../controllers/sites.controller";

export const sitesRouter = Router();

sitesRouter.use(requireAuth, requireTenant);

sitesRouter.get("/", requirePermission(PERMISSIONS.SITE_READ), getSitesController);
// Must stay above "/:id", which would otherwise match "paginated" as an id.
sitesRouter.get("/paginated", requirePermission(PERMISSIONS.SITE_READ), getSitesPageController);
sitesRouter.post("/", requirePermission(PERMISSIONS.SITE_WRITE), validate(createSiteSchema), createSiteController);

sitesRouter.get("/:id", requirePermission(PERMISSIONS.SITE_READ), validate(siteIdParamsSchema), getSiteController);
sitesRouter.patch("/:id", requirePermission(PERMISSIONS.SITE_WRITE), validate(updateSiteSchema), updateSiteController);
// No archive/unarchive pair as products have: `Site` carries no `archivedAt`,
// so a site that is no longer in use is deleted once its machines have moved.
sitesRouter.delete(
  "/:id",
  requirePermission(PERMISSIONS.SITE_WRITE),
  validate(siteIdParamsSchema),
  deleteSiteController,
);
