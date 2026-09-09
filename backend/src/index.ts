import { machinesRouter } from "@/api/routes/machines.route";
import { tenantsRouter } from "@/api/routes/tenants.route";
import { auth } from "@/lib/auth";

import { toNodeHandler } from "better-auth/node";
import dotenv from "dotenv";
import express from "express";

dotenv.config();

const app = express();
const port = process.env.PORT ?? 3000;

// Mounted before express.json(): Better Auth reads the raw request itself.
// Also exposes the multi-tenant plugin's endpoints: POST /api/auth/tenant/switch, GET /api/auth/tenant/mine.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api", tenantsRouter);
app.use("/api", machinesRouter);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
