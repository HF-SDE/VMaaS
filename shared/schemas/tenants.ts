import { z } from "zod/v4";

export const createTenantSchema = z.object({
  name: z.string().min(1, "Title is required"),
  description: z.string().optional(),
});

export const inviteMemberSchema = z.object({
  email: z.string().min(1, "User ID is required"),
  role: z.string().min(1, "Role is required"),
});

export const respondToInviteSchema = z.object({
  params: z.object({ token: z.string().min(1, "Token is required") }),
  body: z.object({ status: z.enum(["accepted", "rejected"], "Status must be either 'accepted' or 'rejected'") }),
});

export const createRoleSchema = z.object({
  name: z.string().min(1, "Name is required"),
  permissions: z.array(z.string()).optional().default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  permissions: z.array(z.string()).optional(),
});
