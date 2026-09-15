import { describe, expect, it } from "vitest";

import { parseFrontendOrigins } from "@/lib/frontend-origins";

describe("parseFrontendOrigins", () => {
  it("accepts a single origin", () => {
    expect(parseFrontendOrigins("http://localhost:3000")).toEqual(["http://localhost:3000"]);
  });

  it("splits a comma-separated list and trims whitespace", () => {
    expect(parseFrontendOrigins("http://localhost, http://localhost:3000 ,https://admin.example.com")).toEqual([
      "http://localhost",
      "http://localhost:3000",
      "https://admin.example.com",
    ]);
  });

  it("ignores empty entries", () => {
    expect(parseFrontendOrigins("http://localhost,,")).toEqual(["http://localhost"]);
  });

  it("rejects an entry that is not a URL", () => {
    expect(() => parseFrontendOrigins("http://localhost,localhost:3000")).toThrow();
  });

  it("rejects an empty value", () => {
    expect(() => parseFrontendOrigins("")).toThrow();
  });
});
