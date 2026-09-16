import { validate } from "@/api/middleware/validate";

import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v4";

/**
 * Driven through a real Express app rather than a mock request: the behaviour
 * under test is that `validate()` can write the coerced query back onto the
 * request, and Express 5 defines `query` as a getter-only accessor on the
 * request prototype. A plain object stands in for a request and hides that.
 */
const schema = z.object({
  query: z.object({
    page: z.coerce.number().optional(),
    flag: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
});

const app = express();
app.get("/", validate(schema), (req, res) => {
  // The controllers re-parse the request after the middleware has run, so the
  // written-back value has to survive a second parse against the same schema.
  res.json(schema.parse(req).query);
});

let baseUrl: string;
let server: ReturnType<typeof app.listen>;

beforeAll(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

const get = async (qs: string) => {
  const response = await fetch(`${baseUrl}/${qs}`);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

describe("validate", () => {
  it("coerces the query and leaves the parsed value on the request", async () => {
    expect(await get("?page=2&flag=false")).toEqual({ status: 200, body: { page: 2, flag: false } });
  });

  it("accepts a request that omits every optional field", async () => {
    expect(await get("")).toEqual({ status: 200, body: {} });
  });

  it("answers 400 rather than throwing when the query is malformed", async () => {
    const { status, body } = await get("?page=abc");
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid request");
  });
});
