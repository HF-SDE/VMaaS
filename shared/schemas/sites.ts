import { z } from "zod/v4";

const CONTACT_EMAIL_MESSAGE = { message: "contact email must be an email address" };
const COUNTRY_CODE_MESSAGE = { message: "country code must be two letters, e.g. DK" };

/**
 * Optional free text on create.
 *
 * A form sends `""` for a field the user never touched, and that has to mean
 * the same thing as a client leaving the key out entirely — so blank is
 * normalised away here instead of failing a `min(1)` the user never asked for.
 * Every column on `Site` except `name` is nullable, so all of them take this.
 */
function optionalText() {
  return z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined);
}

/**
 * Optional free text on update, where `""` and an omitted key are *different*
 * intents. `undefined` means "leave this column alone", while a user who
 * emptied the field means "clear it" — and only `null` reaches the nullable
 * column as a clear.
 */
function updatableText() {
  return z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value || null));
}

/**
 * `latitude` and `longitude` are deliberately absent from both write schemas.
 * They are geocoder output rather than something an admin types, and nothing
 * sends them today; a site is located by its address alone.
 */
export const createSiteSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, { message: "name is required" }),
    addressLine1: optionalText(),
    addressLine2: optionalText(),
    postalCode: optionalText(),
    city: optionalText(),
    countryCode: optionalText()
      .transform((value) => value?.toUpperCase())
      .pipe(z.string().length(2, COUNTRY_CODE_MESSAGE).optional()),
    contactName: optionalText(),
    contactPhone: optionalText(),
    contactEmail: optionalText().pipe(z.email(CONTACT_EMAIL_MESSAGE).optional()),
  }),
});

/** Shared by every `/:id` route, so a malformed id is a 400 rather than a
 *  database error on a value that could never have matched. The controllers
 *  parse it again to read the id as a typed string. */
export const siteIdParamsSchema = z.object({
  params: z.object({
    id: z.uuid({ message: "id must be a uuid" }),
  }),
});

/**
 * Every field is optional so the form can send only what changed, but an
 * entirely empty body is rejected — it would be a write that silently does
 * nothing while answering 200.
 */
export const updateSiteSchema = z.object({
  params: siteIdParamsSchema.shape.params,
  body: z
    .object({
      name: z.string().trim().min(1, { message: "name is required" }).optional(),
      addressLine1: updatableText(),
      addressLine2: updatableText(),
      postalCode: updatableText(),
      city: updatableText(),
      countryCode: updatableText()
        .transform((value) => (typeof value === "string" ? value.toUpperCase() : value))
        .pipe(z.string().length(2, COUNTRY_CODE_MESSAGE).nullable().optional()),
      contactName: updatableText(),
      contactPhone: updatableText(),
      contactEmail: updatableText().pipe(z.email(CONTACT_EMAIL_MESSAGE).nullable().optional()),
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: "at least one field is required",
    }),
});

export const getSitesPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});
