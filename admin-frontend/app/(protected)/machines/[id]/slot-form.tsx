"use client"

import { useForm } from "@tanstack/react-form"
import { Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { ProductPicker } from "@/components/product-picker"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { fetchData } from "@/lib/data/data-fetch"
import { slotWriteSchema } from "@vmaas/shared/schemas"
import type { SimpleProduct } from "@vmaas/shared/types/product"
import type { SlotWriteData } from "@vmaas/shared/types/slot"

import { slotWriteErrorMessage } from "../messages"
import type { SlotListItem } from "./slot-columns"

/**
 * Mirrors `z.input<typeof slotWriteSchema>`. TanStack Form matches the
 * validator's input type against this one invariantly, so all three fields are
 * required here exactly as they are in the schema.
 */
export type SlotFormValues = {
  quantity: number
  capacity: number
  /** `null` is the slot not overriding what the product costs. */
  price: number | null
}

/**
 * The editable half of a slot: which product it holds, how much is in it, how
 * much fits, and what it costs.
 *
 * Takes plain values rather than the slot row, like `<ProductActions>` does: the
 * row carries Prisma's `Decimal` price, and narrowing it here keeps the form to
 * what the inputs actually need.
 */
export function EditSlotForm({
  id,
  defaultValues,
  defaultProduct,
  onSaved,
  onCancel,
}: {
  id: string
  defaultValues: SlotFormValues
  defaultProduct: Pick<SimpleProduct, "id" | "name"> | null
  onSaved: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    defaultProduct?.id ?? null
  )

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: slotWriteSchema,
    },

    onSubmit: async ({ value }) => {
      if (!selectedProductId) {
        toast.error("Select a product for this slot.")
        return
      }

      // All three go every time even when only one changed: the endpoint takes a
      // partial body, and a field that resends the value it already had is a
      // no-op there — the stock ledger is written off the row's delta, not off
      // what the body names.
      const [error] = await fetchData<SlotListItem, SlotWriteData>(
        `/api/slots/${id}`,
        {
          method: "PATCH",
          body: { ...value, productId: selectedProductId },
        }
      )

      if (error) {
        toast.error(slotWriteErrorMessage(error.status))
        return
      }

      toast.success("Slot saved.")
      onSaved()
      router.refresh()
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
        <Field orientation="vertical">
          <FieldLabel htmlFor="product">Product*</FieldLabel>
          <ProductPicker
            id="product"
            name="product"
            defaultValue={defaultProduct?.name}
            onSelect={(product) => setSelectedProductId(product?.id ?? null)}
            disabled={form.state.isSubmitting}
          />
          <FieldDescription>
            Search for the product sold from this slot.
          </FieldDescription>
        </Field>

        <form.Field name="quantity">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Stock*</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                />
                <FieldDescription>
                  Correcting this figure is recorded as a stock movement.
                </FieldDescription>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="capacity">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Capacity*</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(Number(e.target.value))}
                  aria-invalid={isInvalid}
                  autoComplete="off"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        {/* An empty input is `null`, not 0 — clearing the field is how the slot
            stops overriding the product's own price. */}
        <form.Field name="price">
          {(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid} orientation="vertical">
                <FieldLabel htmlFor={field.name}>Price</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  type="number"
                  step="0.01"
                  value={field.state.value ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                  aria-invalid={isInvalid}
                  placeholder="Product price"
                  autoComplete="off"
                />
                <FieldDescription>
                  Leave empty to charge what the product costs.
                </FieldDescription>
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
                Save changes
              </Button>
            )}
          </form.Subscribe>
        </div>
      </FieldGroup>
    </form>
  )
}
