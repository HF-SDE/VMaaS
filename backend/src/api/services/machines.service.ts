import { prisma } from "@/lib/prisma";

export async function getMachinesService(tenantId: string) {
  const machines = await prisma.machine.findMany({ where: { tenantId } });

  return machines;
}

export async function createMachineService(tenantId: string, name: string, location?: string) {
  const machine = await prisma.machine.create({ data: { tenantId, name, location } });

  return machine;
}
