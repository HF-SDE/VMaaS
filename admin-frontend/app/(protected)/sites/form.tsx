"use client"

import { type AnyFieldApi } from "@tanstack/react-form"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { fetchData } from "@/lib/data/data-fetch"
import { SiteUsage } from "@vmaas/shared/types/site"
import { Site } from "@prisma"
import { siteWriteErrorMessage } from "./messages"
import { SiteStepperForm } from "./stepper-form"

/**
 * What `GET`/`PATCH /api/sites/:id` answer with — the row plus its usage
 * flags. Composed here rather than in `@vmaas/shared/types/site`, because the
 * `@prisma` alias that `Site` comes from only exists in this package.
 */
export type SiteDetail = Site & SiteUsage

/**
 * Mirrors `z.input<typeof createSiteSchema.shape.body>`. TanStack Form matches
 * the validator's input type against this one invariantly, so every field that
 * is optional in the schema has to be optional here too — a required `string`
 * makes the validator below stop type-checking.
 */
export type SiteFormValues = {
  name: string
  addressLine1?: string
  addressLine2?: string
  postalCode?: string
  city?: string
  countryCode?: string
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  /**
   * Not typed into a field — the address search writes the pair, and the map
   * reads it. `null` rather than `undefined` is what clears the stored pin on
   * an edit, where an absent key means "leave the column alone".
   */
  latitude?: number | null
  longitude?: number | null
}

/** Every field blank — what the create dialog starts from. */
export const EMPTY_SITE: SiteFormValues = {
  name: "",
  addressLine1: "",
  addressLine2: "",
  postalCode: "",
  city: "",
  countryCode: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  latitude: null,
  longitude: null,
}

/**
 * One labelled text input, bound to a TanStack field.
 *
 * Typed as `AnyFieldApi` rather than the exact field type: the nine fields
 * below differ only in their name and label, and spelling out each generic
 * would be nine near-identical signatures for no extra safety — `form.Field`
 * has already checked the name against `SiteFormValues` by the time this runs.
 */
export function TextField({
  field,
  label,
  placeholder,
  type = "text",
}: {
  field: AnyFieldApi
  label: string
  placeholder?: string
  type?: string
}) {
  const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid

  return (
    <Field data-invalid={isInvalid} orientation="vertical">
      <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
      <Input
        id={field.name}
        name={field.name}
        type={type}
        // The schema leaves optional fields as `string | undefined`, and an
        // undefined `value` would make this an uncontrolled input.
        value={field.state.value ?? ""}
        onBlur={field.handleBlur}
        onChange={(e) => field.handleChange(e.target.value)}
        aria-invalid={isInvalid}
        placeholder={placeholder}
        autoComplete="off"
      />
      {isInvalid && <FieldError errors={field.state.meta.errors} />}
    </Field>
  )
}

/**
 * Creating a site.
 *
 * `createSiteSchema.shape.body` is what the stepper validates against, which is
 * also what this endpoint parses. Everything but the name stays optional — the
 * columns are nullable, so a site can be created from a name alone and filled
 * in later.
 */
export function CreateSiteForm({
  triggerCloseDialog,
}: {
  triggerCloseDialog: () => void
}) {
  const router = useRouter()

  return (
    <SiteStepperForm
      defaultValues={EMPTY_SITE}
      submitLabel="Create site"
      onCancel={triggerCloseDialog}
      onSubmit={async (values) => {
        const [error, site] = await fetchData<Site>("/api/sites", {
          method: "POST",
          body: values,
        })

        // The page's own permission gate redirects to /forbidden, so a
        // `forbidden` here means the backend itself denied the write — no
        // redirect happens there, which would otherwise leave the button silent.
        if (error) {
          const reason = error.reason
          switch (reason) {
            case "FORBIDDEN":
              router.push(
                "/forbidden?reason=" +
                  encodeURIComponent(
                    "You do not have permission to create sites."
                  )
              )
              break
            case "UNAUTHORIZED":
              router.push("/login")
              break
            // No NOT_FOUND or CONFLICT arm: POST /api/sites answers neither.
            case "BAD_REQUEST":
            case "BACKEND_ERROR":
            case "NETWORK_ERROR":
              toast.error(siteWriteErrorMessage(error.status))
              break
            default:
              throw new Error(`Unhandled error - reason: ${reason}`)
          }
        } else {
          triggerCloseDialog()
          router.push("/sites/" + site.id)
        }
        return null
      }}
    />
  )
}

/**
 * Editing a site, through the same stepper as creating one.
 *
 * The edit endpoint accepts partial input, but this form always sends every
 * field, so holding the user to a non-empty name is right on both sides.
 */
export function EditSiteForm({
  id,
  defaultValues,
  onSaved,
  onCancel,
}: {
  id: string
  /** Includes the site's stored coordinates, so the map opens on the existing
   *  pin rather than waiting for the user to pick a new address. */
  defaultValues: SiteFormValues
  onSaved: () => void
  onCancel: () => void
}) {
  const router = useRouter()

  return (
    <SiteStepperForm
      defaultValues={defaultValues}
      submitLabel="Save changes"
      onCancel={onCancel}
      onSubmit={async (values) => {
        const [error] = await fetchData<SiteDetail>(`/api/sites/${id}`, {
          method: "PATCH",
          body: values,
        })

        if (error) return siteWriteErrorMessage(error.status)

        toast.success("Site saved.")
        onSaved()
        // This is what makes the open page re-render with the saved values.
        router.refresh()
        return null
      }}
    />
  )
}
