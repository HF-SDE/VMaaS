import { describe, expect, it, vi } from "vitest";

import { kickMqttClient } from "@/lib/emqx";

const MACHINE = "33333333-3333-4333-8333-333333333333";

describe("kickMqttClient", () => {
  it("asks EMQX to disconnect the machine's client id", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    const result = await kickMqttClient(MACHINE, fetchImpl as unknown as typeof fetch);

    expect(result).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`/api/v5/clients/${MACHINE}`);
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
  });

  // Pins the path: the real EMQX 5.8 API has no `/kick` sub-resource — that
  // wrong path is exactly what shipped, and it 404s just like a client that
  // isn't connected, which is why the previous test suite never caught it.
  it("requests the client by id directly, with no /kick suffix", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));

    await kickMqttClient(MACHINE, fetchImpl as unknown as typeof fetch);

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).not.toContain("/kick");
  });

  it("treats a client that is not connected (CLIENTID_NOT_FOUND) as success", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "CLIENTID_NOT_FOUND", message: "Client ID not found" }), {
          status: 404,
        }),
    );

    expect(await kickMqttClient(MACHINE, fetchImpl as unknown as typeof fetch)).toBe(true);
  });

  // The case that hid the wrong-endpoint bug for an entire task: a missing
  // route also answers 404, but with an HTML body and no CLIENTID_NOT_FOUND
  // code. That must NOT be read as "already disconnected".
  it("answers false for a 404 with an HTML body (the endpoint itself is missing)", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html><body>404 - NOT FOUND</body></html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
    );

    expect(await kickMqttClient(MACHINE, fetchImpl as unknown as typeof fetch)).toBe(false);
  });

  it("answers false when EMQX rejects the call", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 401 }));

    expect(await kickMqttClient(MACHINE, fetchImpl as unknown as typeof fetch)).toBe(false);
  });

  it("answers false rather than throwing when EMQX is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });

    expect(await kickMqttClient(MACHINE, fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});
