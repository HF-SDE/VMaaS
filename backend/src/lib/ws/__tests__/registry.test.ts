import { broadcast, connectionCount, register, send, unregister } from "@/lib/ws/registry";

import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

/** Only the three members the registry touches, so no real socket is needed. */
function fakeSocket(readyState = 1) {
  return { readyState, OPEN: 1, send: vi.fn() } as unknown as WebSocket & { send: ReturnType<typeof vi.fn> };
}

describe("ws registry", () => {
  const registered: Array<[string, WebSocket]> = [];

  /** The registry is module state, so every test tears its own sockets down again. */
  function connect(tenantId: string, readyState = 1) {
    const socket = fakeSocket(readyState);
    register(tenantId, socket);
    registered.push([tenantId, socket]);
    return socket;
  }

  afterEach(() => {
    for (const [tenantId, socket] of registered.splice(0)) unregister(tenantId, socket);
  });

  it("delivers a broadcast only to sockets of that tenant", () => {
    const a = connect(TENANT_A);
    const b = connect(TENANT_B);

    broadcast(TENANT_A, { type: "connected", tenantId: TENANT_A });

    expect(a.send).toHaveBeenCalledWith(JSON.stringify({ type: "connected", tenantId: TENANT_A }));
    expect(b.send).not.toHaveBeenCalled();
  });

  it("reaches every socket of a tenant", () => {
    const first = connect(TENANT_A);
    const second = connect(TENANT_A);

    broadcast(TENANT_A, { type: "connected", tenantId: TENANT_A });

    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledOnce();
  });

  it("skips a socket that is not open", () => {
    const closing = connect(TENANT_A, 2);

    broadcast(TENANT_A, { type: "connected", tenantId: TENANT_A });
    send(closing, { type: "connected", tenantId: TENANT_A });

    expect(closing.send).not.toHaveBeenCalled();
  });

  it("stops delivering to an unregistered socket", () => {
    const socket = connect(TENANT_A);
    unregister(TENANT_A, socket);

    broadcast(TENANT_A, { type: "connected", tenantId: TENANT_A });

    expect(socket.send).not.toHaveBeenCalled();
    expect(connectionCount(TENANT_A)).toBe(0);
  });

  it("is a no-op for a tenant nobody is connected to", () => {
    expect(() => broadcast(TENANT_B, { type: "connected", tenantId: TENANT_B })).not.toThrow();
  });
});
