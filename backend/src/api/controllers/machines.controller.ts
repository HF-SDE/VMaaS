import {
  createMachineSchema,
  getMachinesPageSchema,
  machineIdParamsSchema,
  simpleMachineSearchSchema,
  updateMachineSchema,
} from "@vmaas/shared/schemas";
import { Request, Response } from "express";
import { z } from "zod/v4";

import {
  createMachineService,
  deleteMachineService,
  getMachineByIdService,
  getMachinesPageService,
  getMachinesService,
  simpleMachineSearchService,
  updateMachineService,
} from "../services/machines.service";

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

  const { data, error: parseError } = getMachinesPageSchema.safeParse(req.query);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, page] = await getMachinesPageService(tenantId!, data);

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

/**
 * The machine picker's endpoint: a handful of matches for what the user typed.
 *
 * Like the paginated list, the query is parsed here rather than by `validate()`
 * middleware. A missing or blank `search` is a 400 — an empty query would list
 * the tenant's machines, which is what `GET /api/machines` is for.
 */
export async function simpleMachineSearchController(req: Request, res: Response) {
  const { tenantId } = req;

  const { data, error: parseError } = simpleMachineSearchSchema.safeParse(req.query);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, machines] = await simpleMachineSearchService(tenantId!, data);

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

  const { data, error: parseError } = createMachineSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, machine] = await createMachineService(tenantId!, data.body);

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

  const { data, error: parseError } = machineIdParamsSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, machine] = await getMachineByIdService(tenantId!, data.params.id);

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

  const { data, error: parseError } = updateMachineSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error, machine] = await updateMachineService(tenantId!, data.params.id, data.body);

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

  const { data, error: parseError } = machineIdParamsSchema.safeParse(req);
  if (parseError)
    return res
      .status(400)
      .json({ error: z.treeifyError(parseError) })
      .end();

  const [error] = await deleteMachineService(tenantId!, data.params.id);

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
