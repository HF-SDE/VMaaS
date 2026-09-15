import "server-only"

import { redirect } from "next/navigation"
import type { ReactNode } from "react"
import type { PermissionKey } from "@vmaas/shared/types/permissions"

import { getSession } from "@/lib/dal"
import { forbiddenPath } from "@/lib/forbidden"
import { isPermitted, type PermissionMode } from "@/lib/permissions"

type RoleGateProps = {
  perms: PermissionKey[]
  /** "all" (default) requires every permission; "any" requires one. */
  mode?: PermissionMode
  /** Redirect to /forbidden when denied. Turn it off for conditional UI — a
   *  button the user simply should not see — where a redirect would take the
   *  whole page away over one hidden control. */
  performRedirect?: boolean
  /** Plain Danish copy shown on /forbidden. The call site knows what it was
   *  guarding, so it words the denial. */
  reason?: string
  /** Rendered instead of children when denied and `performRedirect` is false. */
  fallback?: ReactNode
  children: ReactNode
}

/**
 * Gates its children on the session's permissions.
 *
 * This is UI, not security: it decides what to render, while the backend
 * re-checks every request. Never let it stand in for a server-side check.
 *
 * It awaits the session, so render it inside a <Suspense> or the surrounding
 * page loses its static shell under `cacheComponents`.
 */
export async function RoleGate({
  perms,
  mode = "all",
  performRedirect = true,
  reason,
  fallback = null,
  children,
}: RoleGateProps) {
  const session = await getSession()

  if (isPermitted(session, perms, mode)) return <>{children}</>

  // Signed out is not a permission problem, and /forbidden would be a dead end
  // for someone who only needs to log in again.
  if (!session) {
    if (performRedirect) redirect("/login")
    return <>{fallback}</>
  }

  if (performRedirect) redirect(forbiddenPath(reason))

  return <>{fallback}</>
}
