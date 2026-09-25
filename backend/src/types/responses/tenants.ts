import { getMembersService } from "@/api/services/tenants.service";

import type { GetPaginatedResult } from "@vmaas/shared/types/data-table";

export type MembersResponse = Awaited<ReturnType<typeof getMembersService>>[number];

/** What `GET /api/tenants/members/paginated` answers. The row type is the same
 *  one the unpaginated list returns — both services share one `include`. */
export type MembersPageResponse = GetPaginatedResult<MembersResponse>;
