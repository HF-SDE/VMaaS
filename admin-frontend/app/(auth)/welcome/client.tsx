"use client"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { BuildingComplexPlus } from "lucide-react"

import { zodResolver } from "@hookform/resolvers/zod"
import { Controller, useForm } from "react-hook-form"
import * as z from "zod"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { createTenant } from "@/app/(protected)/actions"
import { createTenantSchema } from "@vmaas/shared/schemas"

import { backendPost } from "@/lib/data/post-wrapper"
import { redirect } from "next/navigation"
import { toast } from "sonner"
import { Session } from "@/lib/session-fetch"
import { fetchData } from "@/lib/data/data-fetch"
import { InviteResponses } from "@vmaas/shared/types/tenants"

export type CreateTenantFormData = z.infer<typeof createTenantSchema>

export default function WelcomePageClient({
  tenants,
  tenantInvites,
}: {
  tenants: Session["tenants"]
  tenantInvites: Session["tenantInvites"]
}) {
  async function switchTenant(tenantId: string) {
    const [error] = await backendPost("/api/auth/tenant/switch", { tenantId })
    if (error) {
      // Handle the error appropriately, e.g., show a toast or log it
      toast.error(error.message)
      return
    } else redirect("/machines")
  }

  async function respondToInvite(token: string, status: InviteResponses) {
    const [error] = await fetchData(`/api/tenants/accept-invite/${token}`, {
      method: "POST",
      body: { status },
    })
    if (error) {
      // Handle the error appropriately, e.g., show a toast or log it
      toast.error(error.reason)
      return
    } else redirect("/machines")
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BuildingComplexPlus />
        </EmptyMedia>
        <EmptyTitle>Welcome!</EmptyTitle>
        {tenants.length === 0 && (
          <EmptyDescription>
            You are not a part of any tenants yet!
          </EmptyDescription>
        )}
        <EmptyDescription>
          Create a tenant by suppling the fields below.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <NewTeneantForm />

        {tenants.length > 0 && (
          <EmptyDescription>
            Or join an existing tenant by clicking on the name below
          </EmptyDescription>
        )}

        {tenants.map((tenant) => (
          <Button
            key={tenant.id}
            variant="outline"
            onClick={() => switchTenant(tenant.id)}
          >
            {tenant.name}
          </Button>
        ))}

        {tenantInvites.length > 0 && (
          <EmptyDescription>
            You have been invited to join the following tenants:
          </EmptyDescription>
        )}

        {tenantInvites.map((invite) => (
          <div key={invite.tenantId} className="flex gap-2">
            <span>
              {invite.tenantName} - Invited by {invite.tenantName} as{" "}
              {invite.roleName}
            </span>

            <Button
              key={invite.tenantId}
              variant="outline"
              onClick={() => respondToInvite(invite.token, "accepted")}
            >
              Accept
            </Button>
            <Button
              variant="destructive"
              onClick={() => respondToInvite(invite.token, "rejected")}
            >
              Reject
            </Button>
          </div>
        ))}
      </EmptyContent>
    </Empty>
  )
}

function NewTeneantForm() {
  const form = useForm<CreateTenantFormData>({
    resolver: zodResolver(createTenantSchema),
    defaultValues: { name: "", description: "" },
  })

  async function onSubmit(data: CreateTenantFormData) {
    await createTenant(data)

    redirect("/machines")
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <Controller
        name="name"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Tenant name</FieldLabel>
            <Input
              {...field}
              id="tenant-name"
              aria-invalid={fieldState.invalid}
              placeholder="Tenant name"
              autoComplete="off"
              className="mb-2"
            />
          </Field>
        )}
      />
      <Controller
        name="description"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Tenant description</FieldLabel>
            <Input
              {...field}
              id="tenant-description"
              aria-invalid={fieldState.invalid}
              placeholder="Tenant description"
              autoComplete="off"
              className="mb-2"
            />
          </Field>
        )}
      />

      <Button type="submit">Create tenant</Button>
    </form>
  )
}
