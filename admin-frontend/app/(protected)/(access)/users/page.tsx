import { cache, Suspense } from "react"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { requirePermission } from "@/lib/dal"
import { hasPermission } from "@/lib/permissions"
import { fetchData } from "@/lib/data/data-fetch"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import type { MembersPageResponse } from "@backend-responses"

import { removeMember } from "./actions"
import { InviteMemberDialog } from "./invite-member-dialog"
import { UsersDataTable } from "./user-table"

const NO_READ_ACCESS = "You do not have access to members."

export type TenantRole = {
  id: string
  name: string
  permissions: string[]
}

/** Both the table's Role column and the invite form need the tenant's roles, so
 *  each fetches them behind its own gate — `role:view` can be denied on its own
 *  without taking the member list away. `cache` makes it one request. */
const fetchTenantRoles = cache(async () => {
  const [error, roles] = await fetchData<TenantRole[]>("/api/tenants/roles")
  return error ? undefined : roles
})

async function InviteMember() {
  const roles = await fetchTenantRoles()
  if (!roles) return null

  return <InviteMemberDialog tenantRoles={roles} />
}

async function UsersTableLoader({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const page = Number(params?.["page"] ?? "0")
  const pageSize = Number(params?.["size"] ?? "10")
  // These defaults mirror UsersDataTable's, so the server render and the
  // client's first refetch ask for the same page.
  const sortBy = (params?.["orderBy"] as string | undefined) ?? "name"
  const sortOrder = ((params?.["orderDir"] as string | undefined) ?? "asc") as
    "asc" | "desc"
  const search = (params?.["q"] as string | undefined) ?? ""
  // Re-checked here, not just in the <RoleGate> above: the gate decides what to
  // render, this is what actually guards the data.
  const session = await requirePermission(PERMISSIONS.USER_VIEW, NO_READ_ACCESS)

  // The row gates. They only decide what a row offers — the backend re-checks
  // both the role change and the removal.
  const canRemoveUsers = hasPermission(session, PERMISSIONS.USER_MANAGE)
  const canChangeRoles =
    canRemoveUsers && hasPermission(session, PERMISSIONS.ROLE_VIEW)

  const [, initialData] = await fetchData<MembersPageResponse>(
    "/api/tenants/members/paginated",
    {
      // Listed field by field rather than spread: an object literal is what makes
      // this assignable to the `query` record, and it keeps the wire names visible.
      query: {
        page: page,
        pageSize: pageSize,
        sortBy: sortBy,
        sortOrder: sortOrder,
        search: search,
      },
    }
  )

  return (
    <UsersDataTable
      initialData={initialData ?? undefined}
      currentUserId={session.user.id}
      canChangeRoles={canChangeRoles}
      canRemoveUsers={canRemoveUsers}
      tenantRoles={canChangeRoles ? await fetchTenantRoles() : undefined}
      onRemoveMember={canRemoveUsers ? removeMember : undefined}
    />
  )
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return (
    <div className="container mx-auto py-10">
      <div className="flex w-full justify-between">
        <div className="mb-6">
          <h1 className="text-3xl font-bold tracking-tight">Members</h1>
          <p className="text-muted-foreground">
            Everyone with a role in this tenant.
          </p>
        </div>
        {/* Hiding one control must not redirect the whole page away. */}
        <Suspense>
          <RoleGate
            perms={[PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_VIEW]}
            performRedirect={false}
          >
            <InviteMember />
          </RoleGate>
        </Suspense>
      </div>
      <Suspense fallback={<Loader />}>
        <RoleGate perms={[PERMISSIONS.USER_VIEW]} reason={NO_READ_ACCESS}>
          <UsersTableLoader searchParams={searchParams} />
        </RoleGate>
      </Suspense>
    </div>
  )
}
