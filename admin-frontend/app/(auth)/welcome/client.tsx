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
import { Tenant } from "@prisma"
import { config } from "@/lib/config"
import { redirect } from "next/navigation"

export type CreateTenantFormData = z.infer<typeof createTenantSchema>

export default function WelcomePageClient({ tenants }: { tenants: Tenant[] }) {
  async function switchTenant(tenantId: string) {
    await fetch(config.NEXT_PUBLIC_BACKEND_URL + "/api/auth/tenant/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ tenantId }),
    }).then((res) => res.ok && redirect("/machines"))
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

        <EmptyDescription>
          Or join an existing tenant by clicking on the name below
        </EmptyDescription>

        {tenants.map((tenant) => (
          <Button
            key={tenant.id}
            variant="outline"
            onClick={() => switchTenant(tenant.id)}
          >
            {tenant.name}
          </Button>
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
