import { getSession } from "@/lib/dal"
import { fetchData } from "@/lib/data/data-fetch"
import { hasPermission } from "@/lib/permissions"
import type { MembersResponse } from "@backend-responses"
import { cn } from "cn"
import { InviteMemberForm } from "./invite-member-form"

export const instant = false

export type TenantRole = {
  id: string
  name: string
  permissions: string[]
}

export default async function UsersPage() {
  const session = await getSession(true)

  const [usersErr, members] = await fetchData<MembersResponse[]>(
    "/api/tenants/" + session.activeTenantId + "/members"
  )

  const canInviteUsers =
    hasPermission(session, "user:manage") && hasPermission(session, "role:view")
  const canChangeRoles =
    hasPermission(session, "user:manage") && hasPermission(session, "role:view")
  const canRemoveUsers = hasPermission(session, "user:manage")
  const isSelf = (userId: string) => userId === session.user.id

  const [rolesErr, tenant_roles] =
    await fetchData<TenantRole[]>("/api/tenants/roles")

  if (usersErr) {
    console.error("Error fetching users:", usersErr)
    return <div>Error fetching users: {usersErr.reason}</div>
  }
  if (rolesErr && (canInviteUsers || canChangeRoles)) {
    console.error("Error fetching roles:", rolesErr)
    return <div>Error fetching roles: {rolesErr.reason}</div>
  }

  if (!session.activeTenantId)
    return <div>You must have an active tenant to view this page.</div>

  // TODO: Lav et pænt design

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Members</h1>
        {canInviteUsers && tenant_roles && (
          <InviteMemberForm
            activeTenantId={session.activeTenantId}
            tenantRoles={tenant_roles}
          />
        )}
      </div>

      <ul>
        {members.map((member) => (
          <li key={member.id} className="flex items-center gap-6">
            <p
              className={cn(
                member.user.id === session.user.id ? "font-bold" : ""
              )}
            >
              {member.user.name} - {member.role.name}
            </p>
            {!isSelf(member.userId) && canChangeRoles && (
              <select>
                {tenant_roles &&
                  tenant_roles.map((role) => (
                    <option
                      key={role.name}
                      defaultValue={member.role.name}
                      value={role.name}
                    >
                      {role.name}
                    </option>
                  ))}
              </select>
            )}
            {!isSelf(member.userId) && canRemoveUsers && (
              <button>Remove</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
