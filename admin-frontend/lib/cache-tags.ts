/**
 * Every cached resource keyed to a tenant. Extend when adding a lib/data module.
 *
 * `members:` is listed ahead of its consumer: the backend ships the
 * /internal/tenants/:tenantId/members route, but no lib/data/members.ts exists
 * yet. Revalidating a tag nothing produces is a harmless no-op, and listing it
 * now means the members page cannot ship with a stale-cache bug.
 *
 * Lives in its own module (not actions.ts) so it can be imported without pulling
 * in a "use server" boundary.
 */
export function tenantTags(tenantId: string): string[] {
  return [`machines:${tenantId}`, `members:${tenantId}`]
}
