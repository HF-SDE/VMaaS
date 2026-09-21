import { alertsRouter } from "@/api/routes/alerts.route";
import { deviceRouter } from "@/api/routes/device.route";
import { internalRouter } from "@/api/routes/internal.route";
import { machinesRouter } from "@/api/routes/machines.route";
import { productsRouter } from "@/api/routes/products.route";
import { salesRouter } from "@/api/routes/sales.route";
import { sitesRouter } from "@/api/routes/sites.route";
import { slotsRouter } from "@/api/routes/slots.route";
import { subscriptionsRouter, subscriptionsWebhookRouter } from "@/api/routes/subscriptions.route";
import { tenantsRouter } from "@/api/routes/tenants.route";
import { auth } from "@/lib/auth";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { attachWebSocketServer } from "@/lib/ws/server";
import { startMqttClient, stopMqttClient } from "@/mqtt/client";

import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import http from "http";

const app = express();

const limiter = rateLimit({
  windowMs: config.RATE_LIMIT_RESET_MINUTES * 60 * 1000,
  limit: config.RATE_LIMIT_COUNT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.set("trust proxy", 1);
if (config.NODE_ENV !== "production") app.set("json spaces", 4);

app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(limiter);

const api = express.Router();

// Mounted before express.json(): Better Auth reads the raw request itself.
// Also exposes the multi-tenant plugin's endpoints: POST /api/auth/tenant/switch, GET /api/auth/tenant/mine.
api.all("/auth/*splat", toNodeHandler(auth));

// Also before express.json(), and for the same reason: Stripe's signature is
// computed over the exact bytes it sent, so the webhook needs the raw body. It
// mounts its own express.raw().
api.use("/subscriptions/webhook", subscriptionsWebhookRouter);

api.use(express.json());

api.get("/health", (_req, res) => res.json({ status: "ok" }));

api.use("/alerts", alertsRouter);
api.use("/tenants", tenantsRouter);
api.use("/machines", machinesRouter);
api.use("/products", productsRouter);
api.use("/sites", sitesRouter);
api.use("/slots", slotsRouter);
api.use("/subscriptions", subscriptionsRouter);
api.use("/sales", salesRouter);
api.use("/device", deviceRouter);
api.use("/internal", internalRouter);

app.use("/api", api);

const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT}`);

  // Started after the HTTP server is up, and never awaited: a broker that is
  // down or still starting must not stop the API from serving.
  void startMqttClient().catch((error) => console.error("mqtt: failed to start:", error));
});

/** How long in-flight requests get to finish before the process exits anyway.
 *  Below Docker's default 10 s stop timeout, so the exit is ours, not a SIGKILL. */
const SHUTDOWN_TIMEOUT_MS = 8000;

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);

  setTimeout(() => {
    console.error("shutdown: timed out, exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  server.close();
  server.closeIdleConnections();

  void Promise.allSettled([stopMqttClient(), prisma.$disconnect()]).then(() => process.exit(0));
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
