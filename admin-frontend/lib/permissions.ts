import type { PermissionKey } from "../../shared/types/permissions"
import type { Session } from "./session"

export function hasPermission(
  session: Session | null,
  key: PermissionKey
): boolean {
  return session?.permissions.includes(key) ?? false
}

/** "all" requires every listed permission, "any" requires at least one. */
export type PermissionMode = "all" | "any"

/**
 * The decision behind <RoleGate>, kept pure so it is unit-testable without
 * rendering a server component.
 *
 * An empty `perms` states no requirement and therefore permits — including in
 * "any" mode, where a bare `some` would return false and silently hide
 * children nobody meant to gate.
 */
export function isPermitted(
  session: Session | null,
  perms: PermissionKey[],
  mode: PermissionMode = "all"
): boolean {
  if (perms.length === 0) return true

  return mode === "any"
    ? perms.some((key) => hasPermission(session, key))
    : perms.every((key) => hasPermission(session, key))
}
