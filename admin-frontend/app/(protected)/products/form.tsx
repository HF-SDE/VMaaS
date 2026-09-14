"use client"

import { useForm } from "@tanstack/react-form"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loader2 } from "lucide-react"

import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { createProductSchema } from "@vmaas/shared/schemas"
import { createProductAction, updateProductAction } from "./actions"
import { productWriteErrorMessage } from "./messages"

export type ProductFormValues = {
  name: string
  price: number
}

type ProductFormProps = {
  defaultValues: ProductFormValues
  submitLabel: string
  onCancel: () => void
  /** Resolves to an error message to show, or null when the write succeeded. */
  onSubmit: (values: ProductFormValues) => Promise<string | null>
}

/**
 * The fields shared by creating and editing a product.
 *
 * It owns validation and the submitting state but not what submitting *does* —
 * the caller passes that in, so one set of fields serves both the new-product
 * dialog and the edit dialog on a product's page.
 *
 * `createProductSchema.shape.body` is reused as the validator for both: the
 * edit endpoint accepts partial input, but this form always sends both fields,
 * so requiring both here is what the user should actually be held to.
 */
export function ProductForm({
  defaultValues,
  submitLabel,
  onCancel,
  onSubmit,
}: ProductFormProps) {
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: createProductSchema.shape.body,
      // onBlur: createProductSchema.shape.body,
    },

    onSubmit: async ({ value }) => {
      const message = await onSubmit({ name: value.name, price: value.price })
      if (message) toast.error(message)
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
                <FieldLabel htmlFor={field.name}>Name*</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="text"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="Fx. Sol over sundet"
                  autoComplete="off"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="price">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Price*</FieldLabel>
                <Input
                  type="number"
                  id={field.name}
                  name={field.name}
                  value={field.state.value || ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  aria-invalid={isInvalid}
                  placeholder="Enter price"
                  autoComplete="off"
                />

                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onCancel()}>
            Cancel
          </Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                {submitLabel}
              </Button>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  )
}

export function CreateProductForm({
  triggerCloseDialog,
}: {
  triggerCloseDialog: () => void
}) {
  const router = useRouter()

  return (
    <ProductForm
      defaultValues={{ name: "", price: 0 }}
      submitLabel="Create Product"
      onCancel={triggerCloseDialog}
      onSubmit={async (values) => {
        const [error, product] = await createProductAction(values)

        // The action's own permission gate redirects to /forbidden, so a
        // `forbidden` here means the backend itself denied the write — no
        // redirect happens there, which would otherwise leave the button silent.
        if (error) {
          const reason = error.reason
          switch (reason) {
            case "FORBIDDEN":
              router.push(
                "/forbidden?reason=" +
                  encodeURIComponent(
                    "You do not have permission to create products."
                  )
              )
              break
            case "UNAUTHORIZED":
              router.push("/login")
              break
            // No NOT_FOUND or CONFLICT arm: POST /api/products answers neither,
            // so CreateProductError does not carry them.
            case "BAD_REQUEST":
            case "BACKEND_ERROR":
            case "NETWORK_ERROR":
              toast.error(productWriteErrorMessage(error, "create"))
              break
            default:
              throw new Error(
                `Unhandled error reason ${reason satisfies never}`
              )
          }
        } else {
          triggerCloseDialog()
          router.push("/products/" + product.id)
        }
        return null
      }}
    />
  )
}

export function EditProductForm({
  id,
  defaultValues,
  onSaved,
  onCancel,
}: {
  id: string
  defaultValues: ProductFormValues
  onSaved: () => void
  onCancel: () => void
}) {
  const router = useRouter()

  return (
    <ProductForm
      defaultValues={defaultValues}
      submitLabel="Gem ændringer"
      onCancel={onCancel}
      onSubmit={async (values) => {
        const [error] = await updateProductAction(id, values)

        if (error) return productWriteErrorMessage(error, "save")

        toast.success("Product saved.")
        onSaved()
        // The action revalidated the path; this is what makes the open page
        // re-render with the saved values.
        router.refresh()
        return null
      }}
    />
  )
}
