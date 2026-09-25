import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod/v4";

/**
 * As `validate`, but its 400 keeps the full path of every issue.
 *
 * `validate` answers with `z.flattenError`, which keeps only the first path
 * segment: for a batch that collapses every problem to
 * `fieldErrors: { body: [...] }`, so a client cannot tell which element of an
 * array was rejected. A device draining a queue needs exactly that, or it has
 * to discard a whole batch for one bad record.
 *
 * Raw `path` arrays rather than `z.treeifyError`, which nests an array as
 * `items` with `null` holes for the valid entries — needlessly awkward to walk
 * with cJSON on a microcontroller.
 */
export function validateDetailed<T extends ZodType>(schema: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      res.status(400).json({
        error: "Invalid request",
        issues: result.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        })),
      });
      return;
    }

    const parsed = result.data as { body?: unknown; query?: unknown; params?: unknown };
    if (parsed.body !== undefined) req.body = parsed.body;
    // Express 5 defines `query` as a getter-only accessor on the request
    // prototype, so assigning to it throws. Same treatment as in `validate`.
    if (parsed.query !== undefined)
      Object.defineProperty(req, "query", {
        value: parsed.query,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    if (parsed.params !== undefined) req.params = parsed.params as typeof req.params;

    next();
  };
}
