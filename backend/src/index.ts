import { alertsRouter } from "@/api/routes/alerts.route";
import { deviceRouter } from "@/api/routes/device.route";
import { internalRouter } from "@/api/routes/internal.route";
import { machinesRouter } from "@/api/routes/machines.route";
import { productsRouter } from "@/api/routes/products.route";
import { salesRouter } from "@/api/routes/sales.route";
import { sitesRouter } from "@/api/routes/sites.route";
import { slotsRouter } from "@/api/routes/slots.route";
import { tenantsRouter } from "@/api/routes/tenants.route";
import { auth } from "@/lib/auth";
import { config } from "@/lib/config";
import { attachWebSocketServer } from "@/lib/ws/server";
import { startMqttClient } from "@/mqtt/client";

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
app.set("json spaces", 4);

app.use(helmet());
app.use(cors({ origin: config.FRONTEND_URL, credentials: true }));
app.use(limiter);

const api = express.Router();

// Mounted before express.json(): Better Auth reads the raw request itself.
// Also exposes the multi-tenant plugin's endpoints: POST /api/auth/tenant/switch, GET /api/auth/tenant/mine.
api.all("/auth/*splat", toNodeHandler(auth));

api.use(express.json());

api.get("/health", (_req, res) => res.json({ status: "ok" }));

api.use("/alerts", alertsRouter);
api.use("/tenants", tenantsRouter);
api.use("/machines", machinesRouter);
api.use("/products", productsRouter);
api.use("/sites", sitesRouter);
api.use("/slots", slotsRouter);
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
