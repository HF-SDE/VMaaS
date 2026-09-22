import { getMachinesWithoutTenantService } from "@/api/services/machines.service";

export type { MachineWithoutTenant } from "@/api/services/machines.service";

export type MachinesWithoutTenants = Awaited<ReturnType<typeof getMachinesWithoutTenantService>>[number];

/**
 * What `POST /api/machines/claim` answers. `expiresAt` is a Date here and a
 * string once it has been through JSON, which is why the countdown in the
 * admin frontend accepts both.
 */
export type { ClaimResult } from "@/api/services/activation.service";
