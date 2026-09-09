import { machinesRouter } from "@/api/routes/machines.route";
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
app.use(cors());
app.use(limiter);

// Mounted before express.json(): Better Auth reads the raw request itself.
// Also exposes the multi-tenant plugin's endpoints: POST /api/auth/tenant/switch, GET /api/auth/tenant/mine.
app.all("/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/tenants", tenantsRouter);
app.use("/machines", machinesRouter);

app.listen(config.PORT, () => console.log(`Server listening on port ${config.PORT}`));
