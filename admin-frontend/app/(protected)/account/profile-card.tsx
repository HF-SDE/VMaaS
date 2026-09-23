"use client"

import { useState } from "react"
import { useForm } from "@tanstack/react-form"
import {
  Controller,
  FieldErrors,
  useForm as useReactForm,
} from "react-hook-form"
import { toast } from "sonner"
import { KeyRound, Loader2 } from "lucide-react"
import { updateUserSchema } from "@vmaas/shared/schemas"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { authClient } from "@/lib/auth-client"

import { fetchData } from "@/lib/data/data-fetch"

import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"

type ProfileCardProps = {
  name: string
  email: string
}

/**
 * The user's own details: what the account is, what it is called, and the one
 * way to change the password.
 *
 * The email is shown but not editable — changing it is a verification flow, not
 * a text field, and PUT /api/me deliberately accepts nothing but the name.
 */
export function ProfileCard({ name, email }: ProfileCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
        <CardDescription>
          Your account details and how you sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <div className="grid gap-1">
          <p className="text-sm font-medium">Email</p>
          <p className="text-sm text-muted-foreground">{email}</p>
        </div>

        <Separator />

        <NameForm name={name} />

        <Separator />

        <PasswordReset />
      </CardContent>
    </Card>
  )
}

function NameForm({ name }: { name: string }) {
  const form = useForm({
    defaultValues: { name },
    validators: { onSubmit: updateUserSchema.shape.body },
    onSubmit: async ({ value }) => {
      const [error] = await fetchData("/api/me", {
        method: "PUT",
        body: { name },
      })

      if (error) {
        toast.error(
          error.status === 401
            ? "Your session has expired. Sign in again."
            : error.status === 400
              ? "Check the field and try again."
              : "Could not save your name. Please try again."
        )
        return
      }

      // The action re-fetched the session, so the sidebar and the greeting
      // already show the new name; this only confirms it happened.
      toast.success("Name saved.")
      form.reset({ name: value.name })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
    >
      <FieldGroup>
        <form.Field name="name">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="Your name"
                  autoComplete="name"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Subscribe selector={(s) => [s.isSubmitting, s.isDirty] as const}>
          {([isSubmitting, isDirty]) => (
            <div className="flex justify-start">
              <Button type="submit" disabled={isSubmitting || !isDirty}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Save name
              </Button>
            </div>
          )}
        </form.Subscribe>
      </FieldGroup>
    </form>
  )
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "New password must be at least 8 characters"),
    confirmNewPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: "New password and confirmation do not match",
    path: ["confirmNewPassword"],
  })

type ChangePasswordData = z.infer<typeof changePasswordSchema>

/**
 * Sends the Better Auth reset link rather than asking for a new password here.
 *
 * The email address is the session's, not an input, so a hijacked tab cannot
 * aim the link somewhere else — the worst it can do is mail the real owner.
 */
function PasswordReset() {
  const [pending, setPending] = useState(false)

  const form = useReactForm<ChangePasswordData>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    },
  })

  async function handleSendResetLink(data: ChangePasswordData) {
    const { currentPassword, newPassword } = data

    setPending(true)

    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })

    setPending(false)

    if (error) {
      console.log("Password change error:", error)
      toast.error(error?.message)
      return
    }

    toast.success("Password successfully changed!")
    form.reset()
  }

  function handleInvalid(errors: FieldErrors<ChangePasswordData>) {
    const first = Object.values(errors)[0]
    toast.error(first?.message ?? "Check the fields and try again.")
  }

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">Password</p>
      <form
        className="grid w-1/2 gap-2"
        onSubmit={form.handleSubmit(handleSendResetLink, handleInvalid)}
      >
        <Controller
          name="currentPassword"
          control={form.control}
          render={({ field }) => (
            <Input
              type="password"
              placeholder="Current password"
              autoComplete="off"
              {...field}
            />
          )}
        />
        <Controller
          name="newPassword"
          control={form.control}
          render={({ field }) => (
            <Input
              type="password"
              placeholder="New password"
              autoComplete="off"
              {...field}
            />
          )}
        />
        <Controller
          name="confirmNewPassword"
          control={form.control}
          render={({ field }) => (
            <Input
              type="password"
              placeholder="Confirm new password"
              autoComplete="off"
              {...field}
            />
          )}
        />

        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          Change password
        </Button>
      </form>
    </div>
  )
}
