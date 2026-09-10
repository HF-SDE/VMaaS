import type { PermissionKey } from "../../shared/types/permissions"
import type { Session } from "./session-fetch"

export function hasPermission(
  session: Session | null,
  key: PermissionKey
): boolean {
  return session?.permissions.includes(key) ?? false
}
