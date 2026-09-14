import { z } from "zod/v4";

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, { message: "name is required" }),
    price: z.number().positive({ message: "price must be a positive number" }),
  }),
});

/** Shared by every `/:id` route, so a malformed id is a 400 rather than a
 *  database error on a value that could never have matched. The controllers
 *  parse it again to read the id as a typed string. */
export const productIdParamsSchema = z.object({
  params: z.object({
    id: z.uuid({ message: "id must be a uuid" }),
  }),
});

/**
 * Both fields are optional so the form can send only what changed, but an
 * entirely empty body is rejected — it would be a write that silently does
 * nothing while answering 200.
 */
export const updateProductSchema = z.object({
  params: productIdParamsSchema.shape.params,
  body: z
    .object({
      name: z.string().min(1, { message: "name is required" }).optional(),
      price: z.number().positive({ message: "price must be a positive number" }).optional(),
    })
    .refine((body) => body.name !== undefined || body.price !== undefined, {
      message: "at least one of name or price is required",
    }),
});

export const getProductsPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
  // A query param arrives as a string, and `z.coerce.boolean()` would read the
  // string "false" as true — `stringbool` parses the word.
  includeArchived: z.stringbool().optional(),
});
