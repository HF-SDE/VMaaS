import { Router } from "express";

import {
  mqttAuthnController,
  mqttAuthzController,
  requireInternalSecret,
} from "../controllers/mqtt-auth.controller";
import { mqttConnectionController } from "../controllers/mqtt-connection.controller";

export const internalRouter = Router();

internalRouter.use(requireInternalSecret);

internalRouter.post("/mqtt/authn", mqttAuthnController);
internalRouter.post("/mqtt/authz", mqttAuthzController);
internalRouter.post("/mqtt/connection", mqttConnectionController);
