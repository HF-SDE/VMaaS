import { getSlotsSchema, updateSlotSchema } from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import { getLowStockSlotsService, getMachineSlotsService, updateSlotService } from "../services/slots.service";

/**
 * The same shape as the machines controllers: destructure the service's `Result`
 * tuple, switch on the failure's `reason`, and let the `satisfies never` default
 * arm keep the switch exhaustive — adding a reason to the service stops
 * compiling until the status code and the wording for it are decided here.
 */
export async function getSlotsController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = getSlotsSchema.parse(req);

  const [error, slots] = await getMachineSlotsService(tenantId!, query.machineId);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "Machine not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the slots" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(slots).end();
}

export async function updateSlotController(req: Request, res: Response) {
  const { tenantId, session } = req;

  const { params, body } = updateSlotSchema.parse(req);

  // The stock movement is credited to the signed-in user, taken from the session
  // `requireAuth` put on the request — never from the body.
  const [error, slot] = await updateSlotService(tenantId!, params.id, body, session!.user.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "SLOT_NOT_FOUND":
        return res.status(404).json({ error: "Slot not found" }).end();
      // 400 rather than 404: the missing row is the product the body named, not
      // the slot this route addresses, so what is wrong is the payload. A
      // product of another tenant lands here too — it does not exist as far as
      // this caller is concerned.
      case "PRODUCT_NOT_FOUND":
        return res.status(400).json({ error: "The selected product does not exist" }).end();
      // 409 rather than 400: the body is well formed, it is the row it would
      // leave behind that is not — the same reading as a machine still in use.
      case "SLOT_OVERFILLED":
        return res.status(409).json({ error: "The quantity does not fit the slot's capacity" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while updating the slot" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(slot).end();
}

/**
 * Every slot in the tenant that needs restocking, emptiest first.
 *
 * No parse: the endpoint takes no input beyond the tenant `requireTenant` put on
 * the request.
 */
export async function getLowStockSlotsController(req: Request, res: Response) {
  const { tenantId } = req;

  const [error, slots] = await getLowStockSlotsService(tenantId!);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the low stock slots" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(slots).end();
}
