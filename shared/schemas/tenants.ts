import { z } from "zod/v4";

export const createTenantSchema = z.object({
  name: z.string().min(1, "Title is required"),
  description: z.string().optional(),
});

/**
 * A bare body schema — the invite route has no `validate()` middleware, so the
 * controller parses `req.body` with this, and the invite form reuses it as its
 * own validator. The email is checked here rather than only on the server so a
 * typo is caught before it becomes a "no user with that email" round trip.
 */
export const inviteMemberSchema = z.object({
  email: z.email("Enter a valid email address"),
  role: z.string().min(1, "Select a role"),
});

export const respondToInviteSchema = z.object({
  params: z.object({ token: z.string().min(1, "Token is required") }),
  body: z.object({ status: z.enum(["accepted", "rejected"], "Status must be either 'accepted' or 'rejected'") }),
});

export const createRoleSchema = z.object({
  name: z.string().trim().toLowerCase().min(1, "Name is required"),
  permissions: z.array(z.string()).optional().default([]),
});

export const updateRoleSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  permissions: z.array(z.string()).optional(),
});

export const updateMemberRoleSchema = z.object({
  params: z.object({ userId: z.string() }),
  body: z.object({ roleName: z.string() }),
});

/**
 * Parsed straight off `req.query` in the controller rather than through
 * `validate()`, the same way `getProductsPageSchema` is: every field stays
 * optional so a bare `/members/paginated` is a valid request, and the service
 * is what clamps and whitelists the values it gets.
 */
export const getMembersPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});
