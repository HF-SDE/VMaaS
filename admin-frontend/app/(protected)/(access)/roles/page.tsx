import { cache, Suspense } from "react"
import Loader from "@/components/loader/loader"
import { RoleGate } from "@/components/role-gate"
import { requirePermission } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { hasPermission } from "@/lib/permissions"
import { PERMISSIONS } from "@vmaas/shared/types/permissions"
import { TenantRole } from "../users/page"
import { NewRoleDialog } from "./new-role-dialog"
import { RoleCard } from "./role-card"
import { TenantRolesProvider } from "./tenant-roles.ctx"

const NO_READ_ACCESS = "You do not have access to roles."

/** Both the dialog and the grid need the roles; `cache` makes it one request. */
const fetchTenantRoles = cache(() =>
  fetchData<TenantRole[]>("/api/tenants/roles")
)

async function NewRole() {
  const [error, tenant_roles] = await fetchTenantRoles()
  if (error) return null

  return (
    <TenantRolesProvider tenant_roles={tenant_roles}>
      <NewRoleDialog />
    </TenantRolesProvider>
  )
}

async function RolesLoader() {
  // Re-checked here, not just in the <RoleGate> above: the gate decides what to
  // render, this is what actually guards the data.
  const session = await requirePermission(PERMISSIONS.ROLE_VIEW, NO_READ_ACCESS)
  const canManageRoles = hasPermission(session, PERMISSIONS.ROLE_MANAGE)

  const [rolesErr, tenant_roles] = await fetchTenantRoles()

  if (rolesErr) {
    console.error("Error fetching roles:", rolesErr)
    return <div>Error fetching roles: {rolesErr.reason}</div>
  }

  return (
    <TenantRolesProvider tenant_roles={tenant_roles}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tenant_roles.map((role) => (
          <RoleCard key={role.id} role={role} canManage={canManageRoles} />
        ))}
      </div>
    </TenantRolesProvider>
  )
}

export default function RolesPage() {
  return (
    <div className="container mx-auto py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Roles</h1>
          <p className="text-muted-foreground">
            Manage roles and the permissions granted to each one.
          </p>
        </div>
        {/* Hiding one button must not redirect the whole page away. */}
        <Suspense>
          <RoleGate
            perms={[PERMISSIONS.ROLE_MANAGE, PERMISSIONS.ROLE_VIEW]}
            performRedirect={false}
          >
            <NewRole />
          </RoleGate>
        </Suspense>
      </div>
      <Suspense fallback={<Loader />}>
        <RoleGate perms={[PERMISSIONS.ROLE_VIEW]} reason={NO_READ_ACCESS}>
          <RolesLoader />
        </RoleGate>
      </Suspense>
    </div>
  )
}
