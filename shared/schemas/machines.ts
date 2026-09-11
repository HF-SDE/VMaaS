import { z } from "zod/v4";

import { requireTenantId } from "./general";

export const createMachineSchema = z
  .object({
    body: z.object({
      name: z.string().min(1, { message: "name is required" }),
      location: z.string().min(1, { message: "location is required" }),
    }),
  })
  .extend(requireTenantId.shape);
