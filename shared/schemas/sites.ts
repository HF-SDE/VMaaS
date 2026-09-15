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
 * One half of a coordinate pair.
 *
 * Geocoder output rather than something an admin types, so there is no text
 * normalising here — a client either has the number or it does not. `null` is
 * accepted on both write schemas and clears the column: dropping the pin in the
 * UI has to be able to drop the stored position with it.
 */
function optionalCoordinate(limit: number, label: string) {
  return z
    .number()
    .min(-limit, { message: `${label} must be between -${limit} and ${limit}` })
    .max(limit, { message: `${label} must be between -${limit} and ${limit}` })
    .nullable()
    .optional();
}

/** Reported against `latitude` so the issue lands on a field a form can show,
 *  rather than at the root where a field-keyed UI would drop it. */
const COORDINATE_PAIR_MESSAGE = {
  message: "latitude and longitude must be sent together",
  path: ["latitude"],
};

/**
 * Half a coordinate locates nothing, and a column pair left half-written would
 * read as a site that is somewhere on a line of latitude. Both keys absent is
 * fine — that is a write that does not touch the position at all.
 */
function hasCompleteCoordinates(body: { latitude?: number | null; longitude?: number | null }): boolean {
  const hasLatitude = body.latitude !== undefined && body.latitude !== null;
  const hasLongitude = body.longitude !== undefined && body.longitude !== null;

  return hasLatitude === hasLongitude;
}

export const createSiteSchema = z.object({
  body: z
    .object({
      name: z.string().trim().min(1, { message: "name is required" }),
      addressLine1: optionalText(),
      postalCode: optionalText(),
      city: optionalText(),
      countryCode: optionalText()
        .transform((value) => value?.toUpperCase())
        .pipe(z.string().length(2, COUNTRY_CODE_MESSAGE).optional()),
      contactName: optionalText(),
      contactPhone: optionalText(),
      contactEmail: optionalText().pipe(z.email(CONTACT_EMAIL_MESSAGE).optional()),
      latitude: optionalCoordinate(90, "latitude"),
      longitude: optionalCoordinate(180, "longitude"),
    })
    .refine(hasCompleteCoordinates, COORDINATE_PAIR_MESSAGE),
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
      postalCode: updatableText(),
      city: updatableText(),
      countryCode: updatableText()
        .transform((value) => (typeof value === "string" ? value.toUpperCase() : value))
        .pipe(z.string().length(2, COUNTRY_CODE_MESSAGE).nullable().optional()),
      contactName: updatableText(),
      contactPhone: updatableText(),
      contactEmail: updatableText().pipe(z.email(CONTACT_EMAIL_MESSAGE).nullable().optional()),
      latitude: optionalCoordinate(90, "latitude"),
      longitude: optionalCoordinate(180, "longitude"),
    })
    .refine((body) => Object.values(body).some((value) => value !== undefined), {
      message: "at least one field is required",
    })
    .refine(hasCompleteCoordinates, COORDINATE_PAIR_MESSAGE),
});

/**
 * `GET /api/sites/simple-search`, the site picker's endpoint.
 *
 * `search` is required and one character is enough — the picker searches from
 * the first keystroke — while `limit` is only coerced here and clamped in the
 * service, so a hand-edited `limit=9999` still answers a page.
 */
export const simpleSiteSearchSchema = z.object({
  search: z.string().trim().min(1, { message: "search is required" }),
  limit: z.coerce.number().optional(),
});

export const getSitesPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});
