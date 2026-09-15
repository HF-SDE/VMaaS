import { APIError } from "better-auth";
import type { NextFunction, Request, Response } from "express";
import { type ZodType, z } from "zod/v4";

/**
 * Validates `req.body` / `req.query` / `req.params` against a schema shaped
 * `{ body?, query?, params? }` and replaces each with its parsed (and
 * coerced/defaulted) value. Responds 400 with the flattened Zod errors on
 * failure.
 */
export function validate<T extends ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      res.status(400).json({ error: "Invalid request", details: z.flattenError(result.error) });
      return;
    }

    const parsed = result.data as { body?: unknown; query?: unknown; params?: unknown };
    if (parsed.body !== undefined) req.body = parsed.body;
    if (parsed.query !== undefined) req.query = parsed.query as typeof req.query;
    if (parsed.params !== undefined) req.params = parsed.params as typeof req.params;

    next();
  };
}
