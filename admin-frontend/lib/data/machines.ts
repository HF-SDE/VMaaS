import "server-only"
import { fetchData } from "./data-fetch"

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
export async function getMachines(): Promise<Machine[]> {
  const [error, machines] = await fetchData<Machine[]>("/api/machines")
  if (error) {
    throw error
  }
  return machines
}
