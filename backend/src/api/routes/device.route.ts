import { requireMachine } from "@/api/middleware/require-machine";
import { validate } from "@/api/middleware/validate";
import { validateDetailed } from "@/api/middleware/validate-detailed";

import { activateMachineSchema, commandResultSchema, deviceEventBatchSchema, deviceEventSchema, renewCertificateSchema } from "@vmaas/shared/schemas";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";

import { activateMachineController } from "../controllers/activation.controller";
import {
  getDeviceConfigurationController,
  postCommandResultController,
  postDeviceEventBatchController,
  postDeviceEventController,
  renewCertificateController,
} from "../controllers/device.controller";

export const deviceRouter = Router();

/**
 * Far tighter than the app-wide limiter in index.ts. Activation is guessable
 * in a way the rest of the API is not: the attempts counter on the activation
 * row bounds guesses against one machine, and this bounds them across all of
 * them from one address.
 */
const activationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

// No requireAuth/requireTenant: the one-time code IS the credential. There is
// no session for a device that has never connected before.
deviceRouter.post("/activate", activationLimiter, validate(activateMachineSchema), activateMachineController);

// Everything below is mTLS-only. nginx's :8443 server block has already
// verified the client certificate; requireMachine resolves it to a machine.
// This must sit below `/activate`, which has no certificate yet.
deviceRouter.use(requireMachine);

deviceRouter.get("/configuration", getDeviceConfigurationController);
deviceRouter.post("/command-results", validate(commandResultSchema), postCommandResultController);
deviceRouter.post("/events", validate(deviceEventSchema), postDeviceEventController);
// The batch a machine sends when draining its offline journal. validateDetailed
// rather than validate: a rejected batch must name which record was bad, or the
// device has to throw away nineteen good events to be rid of one.
deviceRouter.post("/events/batch", validateDetailed(deviceEventBatchSchema), postDeviceEventBatchController);
deviceRouter.post("/certificate/renew", validate(renewCertificateSchema), renewCertificateController);
