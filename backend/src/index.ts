import express from "express";
import dotenv from "dotenv";
import { toNodeHandler } from "better-auth/node";
import { auth } from "@/lib/auth";
import { tenantsRouter } from "@/api/routes/tenants.route";
import { machinesRouter } from "@/api/routes/machines.route";

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
