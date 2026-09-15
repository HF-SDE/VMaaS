"use client"

import { fetchData } from "@/lib/data/data-fetch"

import { inviteMemberSchema } from "@vmaas/shared/schemas"
import { useState } from "react"
import { TenantRole } from "./page"

interface InviteMemberFormProps {
  tenantRoles: TenantRole[]
}

export function InviteMemberForm({ tenantRoles }: InviteMemberFormProps) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState("")

  async function handleSubmit() {
    const { data, error } = inviteMemberSchema.safeParse({ email, role })

    if (error) {
      console.error("Validation error:", error)
      return
    }

    const [err] = await fetchData("/api/tenants/members", {
      method: "POST",
      body: data,
    })

    if (err) {
      console.error("Error inviting member:", err)
    } else {
      console.log("Member invited successfully")
    }
  }
  return (
    <form className="flex items-center gap-2">
      <input
        type="text"
        placeholder="email..."
        onChange={(e) => setEmail(e.target.value)}
        value={email}
      />
      <select onChange={(e) => setRole(e.target.value)} value={role}>
        {tenantRoles.map((role) => (
          <option key={role.name} value={role.name} className="capitalize">
            {role.name}
          </option>
        ))}
      </select>
      <button type="button" onClick={handleSubmit}>
        Invite
      </button>
    </form>
  )
}
