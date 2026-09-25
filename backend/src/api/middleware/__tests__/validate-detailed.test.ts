import { describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";

import { validateDetailed } from "@/api/middleware/validate-detailed";

const schema = z.object({
  body: z.object({
    events: z.array(z.object({ type: z.string().min(1), occurredAt: z.iso.datetime() })).min(1).max(50),
  }),
});

function fakeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

describe("validateDetailed", () => {
  it("names the index of the offending event", () => {
    const req = {
      body: {
        events: [
          { type: "door-released", occurredAt: "2026-09-21T10:00:00.000Z" },
          { type: "door-released", occurredAt: "not-a-date" },
        ],
      },
      query: {},
      params: {},
    } as never;
    const res = fakeRes();
    const next = vi.fn();

    validateDetailed(schema)(req, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    const body = res.body as { issues: { path: (string | number)[] }[] };
    expect(body.issues).toHaveLength(1);
    expect(body.issues[0].path).toEqual(["body", "events", 1, "occurredAt"]);
  });

  it("reports every offending record, not just the first", () => {
    const req = {
      body: {
        events: [
          { type: "", occurredAt: "nope" },
          { type: "door-released", occurredAt: "2026-09-21T10:00:00.000Z" },
          { type: "", occurredAt: "2026-09-21T10:00:00.000Z" },
        ],
      },
      query: {},
      params: {},
    } as never;
    const res = fakeRes();

    validateDetailed(schema)(req, res as never, vi.fn());

    const body = res.body as { issues: { path: (string | number)[] }[] };
    const indexes = new Set(body.issues.map((i) => i.path[2]));
    expect(indexes).toEqual(new Set([0, 2]));
  });

  it("passes a valid body through and replaces req.body with the parsed value", () => {
    const req = {
      body: { events: [{ type: "door-released", occurredAt: "2026-09-21T10:00:00.000Z" }] },
      query: {},
      params: {},
    } as never as { body: { events: unknown[] } };
    const next = vi.fn();

    validateDetailed(schema)(req as never, fakeRes() as never, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body.events).toHaveLength(1);
  });
});
