import { z } from "zod/v4";

export const requireTenantId = z.object({ tenantId: z.string().min(1, { message: "tenantId is required" }) });
