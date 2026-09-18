import { getSalesService } from "@/api/services/sales.service";

export type SalesResponse = Awaited<ReturnType<typeof getSalesService>>[number];

// `GET /api/sales/map` has no entry here on purpose: its shape is
// `SaleMapPoint` in `@vmaas/shared/types/sale`, declared once and imported by
// both sides rather than inferred back out of the service.
