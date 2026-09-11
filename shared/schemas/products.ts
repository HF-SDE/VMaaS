import { z } from "zod/v4";

export const createProductSchema = z.object({
  body: z.object({
    name: z.string().min(1, { message: "name is required" }),
    price: z.number().positive({ message: "price must be a positive number" }),
  }),
});

export const getProductsPageSchema = z.object({
  page: z.coerce.number().optional(),
  pageSize: z.coerce.number().optional(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
  search: z.string().optional(),
});