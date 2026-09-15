"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { InviteMemberForm } from "./invite-member-form"
import { TenantRole } from "./page"

export function InviteMemberDialog({
  tenantRoles,
}: {
  tenantRoles: TenantRole[]
}) {
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button variant="default">Invite member</Button>}
      />
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            Invite an existing VMaaS user to this tenant. They join once they
            accept the invitation.
          </DialogDescription>
        </DialogHeader>
        <InviteMemberForm
          tenantRoles={tenantRoles}
          triggerCloseDialog={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
