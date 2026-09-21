"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { PermissionKey } from "../../shared/types/permissions"

import { hasPermission } from "./permissions"
import type { Session, SessionSubscription } from "./session-fetch"
import { subscription_status } from "@prisma"

type SessionContextValue = {
  user: Session["user"]
  activeTenantId: string | null
  tenants: Session["tenants"]
  hasPermission: (key: PermissionKey) => boolean
  subscriptionStatus: subscription_status | null
}

const SessionContext = createContext<SessionContextValue | undefined>(undefined)

export function SessionProvider({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}) {
  const value = useMemo<SessionContextValue>(
    () => ({
      user: session.user,
      activeTenantId: session.activeTenantId,
      tenants: session.tenants,
      hasPermission: (key) => hasPermission(session, key),
      subscriptionStatus: session.subscription?.status ?? null,
    }),
    [session]
  )

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession() {
  const session = useContext(SessionContext)
  if (!session)
    throw new Error("useSession must be used inside SessionProvider")
  return session
}
