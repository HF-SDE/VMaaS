import "server-only"
import { fetchData } from "./data-fetch"

/** Hand-written rather than Prisma's row: this one is read over the wire, so the
 *  dates are strings. `site` is what `GET /api/machines` includes — a machine
 *  always stands at one. */
export type Machine = {
  id: string
  tenantId: string
  name: string
  siteId: string
  site: { id: string; name: string; city: string | null }
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
