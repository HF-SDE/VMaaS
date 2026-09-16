import { getSalesService } from "@/api/services/sales.service";

export type SalesResponse = Awaited<ReturnType<typeof getSalesService>>[number];
