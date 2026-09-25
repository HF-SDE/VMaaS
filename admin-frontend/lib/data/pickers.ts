import { fetchData } from "./data-fetch"
import type { SimpleMachine } from "@vmaas/shared/types/machine"
import type { SimpleSite } from "@vmaas/shared/types/site"

/**
 * The two `simple-search` endpoints behind the filter comboboxes.
 *
 * Client-capable on purpose (no `"server-only"`): a picker searches as the user
 * types. Both endpoints require a non-empty `search` and answer a short list,
 * so neither can be used to enumerate a tenant's rows.
 *
 * Failures answer `[]` rather than throwing. A picker that cannot reach the API
 * should show "no matches" and let the user keep typing — the filter it feeds
 * is optional, so there is nothing here worth taking a page down for.
 */
const LIMIT = 10

export async function searchMachines(search: string): Promise<SimpleMachine[]> {
  if (!search.trim()) return []

  const [error, machines] = await fetchData<SimpleMachine[]>(
    "/api/machines/simple-search",
    { query: { search: search.trim(), limit: LIMIT } }
  )

  return error ? [] : machines
}

export async function searchSites(search: string): Promise<SimpleSite[]> {
  if (!search.trim()) return []

  const [error, sites] = await fetchData<SimpleSite[]>(
    "/api/sites/simple-search",
    { query: { search: search.trim(), limit: LIMIT } }
  )

  return error ? [] : sites
}
