import { Request, Response } from "express";

import { updateUserService } from "../services/me.service";

export async function updateUserController(req: Request, res: Response) {
  const data = req.body as { name?: string };
  const userId = req.session?.user?.id!;

  const updatedUser = await updateUserService(userId, data);

  return res.status(200).json(updatedUser);
}
