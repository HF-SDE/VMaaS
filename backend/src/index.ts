import { alertsRouter } from "@/api/routes/alerts.route";
import { machinesRouter } from "@/api/routes/machines.route";
import { productsRouter } from "@/api/routes/products.route";
import { salesRouter } from "@/api/routes/sales.route";
import { sitesRouter } from "@/api/routes/sites.route";
import { tenantsRouter } from "@/api/routes/tenants.route";
import { auth } from "@/lib/auth";
import { config } from "@/lib/config";

import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";

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
api.use("/sales", salesRouter);

app.use("/api", api);

app.listen(config.PORT, () => console.log(`Server listening on port ${config.PORT}`));
