import { getMachinesWithoutTenantService } from "@/api/services/machines.service";

export type { MachineWithoutTenant } from "@/api/services/machines.service";

export type MachinesWithoutTenants = Awaited<ReturnType<typeof getMachinesWithoutTenantService>>[number];
