import type { WsServerMessage } from "@vmaas/shared/schemas";
import type { WebSocket } from "ws";

/**
 * Open sockets grouped by the tenant they were authorised for, so a broadcast
 * can never reach a socket belonging to another tenant. Membership is decided
 * once during the upgrade handshake (see server.ts) and never re-read from the
 * frame, which is what keeps tenant isolation a property of the connection
 * rather than of each message.
 */
const socketsByTenant = new Map<string, Set<WebSocket>>();

export function register(tenantId: string, socket: WebSocket) {
  let sockets = socketsByTenant.get(tenantId);
  if (!sockets) {
    sockets = new Set();
    socketsByTenant.set(tenantId, sockets);
  }
  sockets.add(socket);
}

export function unregister(tenantId: string, socket: WebSocket) {
  const sockets = socketsByTenant.get(tenantId);
  if (!sockets) return;

  sockets.delete(socket);
  if (sockets.size === 0) socketsByTenant.delete(tenantId);
}

export function send(socket: WebSocket, message: WsServerMessage) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

/** Pushes a message to every open socket of one tenant. Safe to call when nobody is connected. */
export function broadcast(tenantId: string, message: WsServerMessage) {
  const sockets = socketsByTenant.get(tenantId);
  if (!sockets) return;

  const payload = JSON.stringify(message);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

/** Number of open sockets for a tenant, or for every tenant when none is given. Used by tests. */
export function connectionCount(tenantId?: string): number {
  if (tenantId !== undefined) return socketsByTenant.get(tenantId)?.size ?? 0;

  let total = 0;
  for (const sockets of socketsByTenant.values()) total += sockets.size;
  return total;
}
