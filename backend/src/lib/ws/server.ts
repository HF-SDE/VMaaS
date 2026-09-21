import { auth } from "@/lib/auth";
import { config } from "@/lib/config";
import { isTenantMember } from "@/lib/rbac";
import { broadcast, connectionCount, register, send, unregister } from "@/lib/ws/registry";

import { fromNodeHeaders } from "better-auth/node";
import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import { type WebSocket, WebSocketServer } from "ws";

export { broadcast, connectionCount };

const PATH = "/api/ws";

/** How often a ping goes out. A socket that has not answered the previous one by then is dropped. */
const HEARTBEAT_MS = 30_000;

/**
 * `ws` cannot see a socket that died without a close frame (laptop lid closed,
 * NAT timeout), so it would sit in the registry forever and be broadcast to.
 * Marking every socket dead on each sweep and letting its pong revive it makes
 * that self-correcting.
 */
const alive = new WeakSet<WebSocket>();

/** Every connection is authorised before the upgrade, so `noServer` rather than letting `ws` accept. */
const wss = new WebSocketServer({ noServer: true });

/**
 * Resolves who is connecting and which tenant the socket may see, or null when
 * the request should be rejected. Mirrors the `requireAuth` + `requireTenant`
 * middleware pair, which cannot be reused here because an upgrade is not an
 * Express request.
 */
async function authorize(req: IncomingMessage): Promise<string | null> {
  const origin = req.headers.origin;
  if (!origin || !config.FRONTEND_URL.includes(origin)) return null;

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return null;

  // `req.url` is path-only on an upgrade, so it needs a base to parse against.
  const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
  const tenantId = url.searchParams.get("tenantId") ?? session.session.activeTenantId ?? undefined;
  if (!tenantId) return null;

  if (!(await isTenantMember(session.user.id, tenantId))) return null;

  return tenantId;
}

/**
 * Serves `/api/ws` on an existing HTTP server. Call once, after the Express app
 * is wrapped in `http.createServer`.
 */
export function attachWebSocketServer(server: Server) {
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "", `http://${req.headers.host ?? "localhost"}`);
    if (url.pathname !== PATH) return socket.destroy();

    // Nothing is written to the socket before this resolves, so an unauthorised
    // client never reaches the `connection` handler.
    void authorize(req)
      .then((tenantId) => {
        if (!tenantId) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          return socket.destroy();
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          alive.add(ws);
          register(tenantId, ws);

          ws.on("pong", () => alive.add(ws));
          ws.on("close", () => unregister(tenantId, ws));
          ws.on("error", () => ws.terminate());

          send(ws, { type: "connected", tenantId });
        });
      })
      .catch(() => socket.destroy());
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_MS);

  // Lets the process exit (tests, SIGTERM) instead of being held open by the timer.
  heartbeat.unref();

  return wss;
}
