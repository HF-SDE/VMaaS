"use server"

import { revalidatePath } from "next/cache"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"

import { requirePermission } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"

import { err, HttpError, ok, Result } from "@vmaas/shared/lib/error-handling"

const NO_WRITE_ACCESS = "You do not have permission to change members."

/**
 * Removes a member from the **active** tenant.
 *
 * The tenant is never a parameter — `requirePermission` resolves it from the
 * session and the backend scopes the delete to `req.tenantId`, so a caller
 * cannot reach into another tenant by passing an id. The gate here is the
 * frontend's own: `requirePermission(USER_MANAGE)` on the route, re-checked by
 * the API's middleware chain.
 *
 * A failed call is returned rather than thrown so the row can word it in place;
 * a redirect from the gate still throws, which is what sends a denied user to
 * /forbidden.
 */
export type RemoveMemberResult = Result<HttpError, unknown>

export async function removeMember(
  userId: string
): Promise<RemoveMemberResult> {
  await requirePermission(PERMISSIONS.USER_MANAGE, NO_WRITE_ACCESS)

  const [error, data] = await fetchData(`/api/tenants/members/${userId}`, {
    method: "DELETE",
  })

  if (error) return err(error)

  // The table refetches its own rows on the client; this is for the server
  // render behind it, so a reload does not bring the removed row back.
  revalidatePath("/users")

  return ok(data)
}
