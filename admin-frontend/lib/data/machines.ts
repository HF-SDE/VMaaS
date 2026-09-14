import "server-only"

import { backendFetch } from "../backend"

export type Machine = {
  id: string
  tenantId: string
  name: string
  location: string | null
  status: "online" | "offline" | "error"
  createdAt: string
}

/**
 * `tenantId` must come from a lib/dal.ts `require*` gate. The backend re-checks
 * membership and permissions, so passing a foreign tenant 403s rather than leaking.
 */
export async function getMachines(tenantId: string): Promise<Machine[]> {
  return backendFetch<Machine[]>("/api/machines")
}
