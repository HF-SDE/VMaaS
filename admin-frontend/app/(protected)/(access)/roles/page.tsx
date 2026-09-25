import { getSession } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { hasPermission } from "@/lib/permissions"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { TenantRole } from "../users/page"
import { NewRoleDialog } from "./new-role-dialog"
import { RoleCard } from "./role-card"
import { TenantRolesProvider } from "./tenant-roles.ctx"

export const instant = false

export default async function RolesPage() {
  const session = await getSession(true)

  const [rolesErr, tenant_roles] =
    await fetchData<TenantRole[]>("/api/tenants/roles")

  if (rolesErr) {
    console.error("Error fetching roles:", rolesErr)
    return <div>Error fetching roles: {rolesErr.reason}</div>
  }

  const canManageRoles = hasPermission(session, PERMISSIONS.ROLE_MANAGE)

  return (
    <TenantRolesProvider tenant_roles={tenant_roles}>
      <div className="container mx-auto py-10">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
            <p className="text-muted-foreground">
              Manage roles and the permissions granted to each one.
            </p>
          </div>
          {canManageRoles && <NewRoleDialog />}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tenant_roles.map((role) => (
            <RoleCard key={role.id} role={role} canManage={canManageRoles} />
          ))}
        </div>
      </div>
    </TenantRolesProvider>
  )
}
