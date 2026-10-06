"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  PERMISSIONS,
  type PermissionKey,
} from "@vmaas/shared/types/permissions"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { createRoleSchema } from "@vmaas/shared/schemas"
import { useTenantRoles } from "./tenant-roles.ctx"

export type RoleFormValues = {
  name: string
  permissions: string[]
}

/** Permission keys grouped by their "resource:action" prefix, for a tidier checkbox layout. */
const PERMISSION_GROUPS = Object.values(PERMISSIONS).reduce<
  Record<string, PermissionKey[]>
>((groups, key) => {
  const [resource] = key.split(":")
  groups[resource] ??= []
  groups[resource].push(key)
  return groups
}, {})

type RoleFormProps = {
  defaultValues: RoleFormValues
  submitLabel: string
  onCancel: () => void
  /** Resolves to an error message to show, or null when the write succeeded. */
  onSubmit: (values: RoleFormValues) => Promise<string | null>
  type?: "create" | "edit"
}

export function RoleForm({
  defaultValues,
  submitLabel,
  onCancel,
  onSubmit,
  type = "create",
}: RoleFormProps) {
  const tenant_roles = useTenantRoles()

  const [name, setName] = useState(defaultValues.name)
  const [permissions, setPermissions] = useState<Set<string>>(
    new Set(defaultValues.permissions)
  )
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function togglePermission(key: string, checked: boolean) {
    setPermissions((prev) => {
      const next = new Set(prev)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const { data, error } = createRoleSchema.safeParse({
      name,
      permissions: Array.from(permissions),
    })

    if (error || !data) {
      setError(error?.issues[0].message ?? "Invalid input")
      return
    }

    if (
      type === "create" &&
      tenant_roles.some((role) => role.name === data.name)
    ) {
      setError("A role with this name already exists.")
      return
    }

    if (
      type === "edit" &&
      defaultValues.name !== data.name &&
      tenant_roles.some((role) => role.name === data.name)
    ) {
      setError("A role with this name already exists.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    const message = await onSubmit(data)
    setIsSubmitting(false)
    if (message) setError(message)
  }

  return (
    <form onSubmit={handleSubmit}>
      <FieldGroup>
        <Field orientation="vertical">
          <FieldLabel htmlFor="role-name">Name*</FieldLabel>
          <Input
            id="role-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fx. manager"
            autoComplete="off"
          />
        </Field>

        <Field orientation="vertical">
          <FieldLabel>Permissions</FieldLabel>
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.entries(PERMISSION_GROUPS).map(([resource, keys]) => (
              <div key={resource} className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground capitalize">
                  {resource}
                </p>
                {keys.map((key) => (
                  <Label
                    key={key}
                    className="flex items-center gap-2 font-normal"
                  >
                    <Checkbox
                      checked={permissions.has(key)}
                      onCheckedChange={(checked) =>
                        togglePermission(key, checked === true)
                      }
                    />
                    {key}
                  </Label>
                ))}
              </div>
            ))}
          </div>
        </Field>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </div>
      </FieldGroup>
    </form>
  )
}
