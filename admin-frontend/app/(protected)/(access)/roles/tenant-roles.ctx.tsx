"use client"

import { createContext, useContext } from "react"
import { TenantRole } from "../users/page"

const TenantRolesContext = createContext<TenantRole[] | null>(null)

interface TenantRolesProviderProps {
  children: React.ReactNode
  tenant_roles: TenantRole[]
}

function TenantRolesProvider({
  children,
  tenant_roles,
}: TenantRolesProviderProps) {
  return (
    <TenantRolesContext.Provider value={tenant_roles}>
      {children}
    </TenantRolesContext.Provider>
  )
}

function useTenantRoles() {
  const context = useContext(TenantRolesContext)
  if (context === null) {
    throw new Error("useTenantRoles must be used within a TenantRolesProvider")
  }
  return context
}

export { TenantRolesContext, TenantRolesProvider, useTenantRoles }
