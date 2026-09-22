import { UserUpdateInput } from "@/generated/prisma/models";
import { prisma } from "@/lib/prisma";

export async function updateUserService(userId: string, data: UserUpdateInput) {
  const updatedUser = await prisma.user.update({ where: { id: userId }, data });

  return updatedUser;
}
