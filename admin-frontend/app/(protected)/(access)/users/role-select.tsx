"use client"

import { MembersResponse } from "@/types/responses"
import { TenantRole } from "./page"
import { fetchData } from "@/lib/data/data-fetch"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"

interface RoleSelectProps {
  tenant_roles: TenantRole[]
  member: MembersResponse
}

export function RoleSelect({ tenant_roles, member }: RoleSelectProps) {
  async function handleRoleChange(roleId: string) {
    const selectedRole = tenant_roles.find((role) => role.id === roleId)

    if (!selectedRole) {
      console.error("Selected role not found:", roleId)
      return
    }

    const [error, data] = await fetchData(
      `/api/tenants/members/${member.user.id}/role`,
      {
        method: "PUT",
        body: { roleName: selectedRole.name },
      }
    )
    if (error) {
      toast.error("Failed to update role - status: " + error)
    } else {
      toast.success("Role updated successfully")
    }
  }

  return (
    <Select
      items={tenant_roles.map((role) => ({ value: role.id, label: role.name }))}
      defaultValue={member.role.id}
      onValueChange={(value) => value && handleRoleChange(value)}
    >
      <SelectTrigger
        className="w-45"
        aria-label={`Role for ${member.user.name}`}
      >
        <SelectValue placeholder="Role" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {tenant_roles.map((role) => (
            <SelectItem key={role.id} value={role.id}>
              {role.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
