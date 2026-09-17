import {
  createMachineSchema,
  getMachinesPageSchema,
  machineIdParamsSchema,
  saveSlotLayoutSchema,
  simpleMachineSearchSchema,
  updateMachineSchema,
} from "@vmaas/shared/schemas";
import { Request, Response } from "express";

import {
  createMachineService,
  deleteMachineService,
  getMachineByIdService,
  getMachineWithoutTenantService,
  getMachinesPageService,
  getMachinesService,
  getMachinesWithoutTenantService,
  saveSlotLayoutService,
  simpleMachineSearchService,
  updateMachineService,
} from "../services/machines.service";

/**
 * Every controller destructures the service's `Result` tuple and switches on
 * the failure's `reason`. The `satisfies never` in each default arm is what
 * makes it exhaustive: adding a reason to a service stops compiling until the
 * status code and the wording for it are decided here.
 *
 * Params and bodies reach the services through a schema parse of the request
 * rather than a cast: Express types a route param as `string | string[]`, so
 * the parse is what turns `req.params.id` into the uuid string a service takes.
 *
 * That parse throws rather than answering 400 itself. The router's
 * `validate(schema)` middleware has already rejected a malformed request
 * against the same schema, so a throw here means the two disagree — a bug, not
 * bad input, and it belongs in the error handler rather than in a 400 the
 * client can do nothing with.
 */
export async function getMachinesController(req: Request, res: Response) {
  const { tenantId } = req;

  const [error, machines] = await getMachinesService(tenantId!);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the machines" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(machines).end();
}

export async function getMachinesPageController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = getMachinesPageSchema.parse(req);

  const [error, page] = await getMachinesPageService(tenantId!, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the machines" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(page).end();
}

export async function getMachinesWithoutTenantController(req: Request, res: Response) {
  const machines = await getMachinesWithoutTenantService();

  return res.status(200).json(machines).end();
}

export async function getMachineWithoutTenantController(req: Request, res: Response) {
  const { params } = machineIdParamsSchema.parse(req);

  const [error, machine] = await getMachineWithoutTenantService(params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "Machine not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the machine" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(machine).end();
}

/**
 * Saves the slot layout editor's layout. Superadmin only, and not tenant-scoped:
 * the layout is set up before the machine is given to a tenant.
 */
export async function saveSlotLayoutController(req: Request, res: Response) {
  const { body } = saveSlotLayoutSchema.parse(req);

  const [error, slots] = await saveSlotLayoutService(body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      // 404: the machine is what this request addresses
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "Machine not found" }).end();
      // 400 rather than 404: a wrong slot id is a problem with the payload
      case "SLOT_NOT_FOUND":
        return res.status(400).json({ error: "One or more slots do not belong to this machine" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while saving the slot layout" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(slots).end();
}

/**
 * The machine picker's endpoint: a handful of matches for what the user typed.
 *
 * A missing or blank `search` is a 400 from `validate()` — an empty query would
 * list the tenant's machines, which is what `GET /api/machines` is for.
 */
export async function simpleMachineSearchController(req: Request, res: Response) {
  const { tenantId } = req;

  const { query } = simpleMachineSearchSchema.parse(req);

  const [error, machines] = await simpleMachineSearchService(tenantId!, query);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while searching the machines" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(machines).end();
}

export async function createMachineController(req: Request, res: Response) {
  const { tenantId } = req;

  const { body } = createMachineSchema.parse(req);

  const [error, machine] = await createMachineService(tenantId!, body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      // 400 rather than 404: the missing row is the site the body named, not the
      // machine this route addresses, so what is wrong is the payload. A site of
      // another tenant lands here too — it does not exist as far as this
      // caller is concerned.
      case "SITE_NOT_FOUND":
        return res.status(400).json({ error: "The selected site does not exist" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while creating the machine" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(201).json(machine).end();
}

export async function getMachineController(req: Request, res: Response) {
  const { tenantId } = req;

  const { params } = machineIdParamsSchema.parse(req);

  const [error, machine] = await getMachineByIdService(tenantId!, params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "Machine not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while loading the machine" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(machine).end();
}

export async function updateMachineController(req: Request, res: Response) {
  const { tenantId } = req;

  const { params, body } = updateMachineSchema.parse(req);

  const [error, machine] = await updateMachineService(tenantId!, params.id, body);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "Machine not found" }).end();
      // As on create: the 404 above is the machine, so a missing site is a 400
      // about the body rather than a second meaning for the same status.
      case "SITE_NOT_FOUND":
        return res.status(400).json({ error: "The selected site does not exist" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while updating the machine" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json(machine).end();
}

export async function deleteMachineController(req: Request, res: Response) {
  const { tenantId } = req;

  const { params } = machineIdParamsSchema.parse(req);

  const [error] = await deleteMachineService(tenantId!, params.id);

  if (error) {
    const reason = error.reason;
    switch (reason) {
      case "MACHINE_IN_USE":
        return res.status(409).json({ error: "Machine is used by one or more slots or sales" }).end();
      case "MACHINE_NOT_FOUND":
        return res.status(404).json({ error: "Machine not found" }).end();
      case "UNKNOWN_ERROR":
        return res.status(500).json({ error: "An unknown error occurred while deleting the machine" }).end();
      default:
        throw new Error(`Unhandled error reason ${reason satisfies never}`);
    }
  }

  return res.status(200).json({ success: true }).end();
}
