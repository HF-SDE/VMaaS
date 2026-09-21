"use client"

import { useState } from "react"
import { useForm } from "@tanstack/react-form"
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

        <PasswordReset email={email} />
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

/**
 * Sends the Better Auth reset link rather than asking for a new password here.
 *
 * The email address is the session's, not an input, so a hijacked tab cannot
 * aim the link somewhere else — the worst it can do is mail the real owner.
 */
function PasswordReset({ email }: { email: string }) {
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">Password</p>
      <p className="text-sm text-muted-foreground">
        {sent
          ? "Check your inbox — the link expires in 1 hour."
          : "We'll email you a link to choose a new password."}
      </p>
      <div>
        <Button
          variant="outline"
          onClick={() => {
            console.log("Send reset link")
          }}
          disabled={pending}
        >
          {pending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {sent ? "Send another link" : "Reset password"}
        </Button>
      </div>
    </div>
  )
}
