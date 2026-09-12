import { z } from "zod/v4";

export const createTenantSchema = z.object({
  name: z.string().min(1, "Title is required"),
  description: z.string().optional(),
});
