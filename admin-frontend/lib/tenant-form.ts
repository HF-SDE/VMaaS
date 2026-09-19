import type { z } from "zod"
import type { createTenantSchema } from "@vmaas/shared/schemas"

/** The create-organization form's values. Derived from the shared schema so the
 *  form, the server action and the API agree on one shape. */
export type CreateTenantFormData = z.infer<typeof createTenantSchema>
