"use client"

import { ChevronsUpDown, Plus } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useEffect, useState } from "react"
import { config } from "@/lib/config"

import { authClient } from "@/lib/auth-client"

// TODO: Implement types
// TODO: Render skeleton while loading

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const [tenants, setTenants] = useState([])

  const [activeTenant, setActiveTenant] = useState(null)

  async function switchActiveTenant(tenant) {
    try {
      const response = await fetch(
        config.BACKEND_URL + "/api/auth/tenant/switch",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ tenantId: tenant.id }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json()
        console.error("Failed to switch active tenant:", errorData)
        return
      }

      setActiveTenant(tenant)
    } catch (error) {
      console.error("Error switching active tenant:", error)
    }
  }

  useEffect(() => {
    const fetchTeams = async () => {
      const response = await fetch(config.BACKEND_URL + "/api/tenants", {
        credentials: "include",
      })
      const data = await response.json()
      if (!response.ok) {
        console.error("Failed to fetch teams:", data)
        return
      }
      setTenants(data)

      const { data: sessionInfo, error } = await authClient.getSession()

      if (error || !sessionInfo) {
        console.error("Failed to get session:", error)
        return
      }

      const activeTenantId = sessionInfo.session.activeTenantId

      const activeTenant = data.find((tenant) => tenant.id === activeTenantId)

      setActiveTenant(activeTenant || null)
    }

    fetchTeams()
  }, [])

  console.log(tenants, activeTenant)

  if (!tenants || tenants.length === 0) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  {/* <activeTeam.logo className="size-4" /> */}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {activeTenant?.name}
                  </span>
                  <span className="truncate text-xs">{activeTenant?.plan}</span>
                </div>
                <ChevronsUpDown className="ml-auto" />
              </SidebarMenuButton>
            }
          ></DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Teams
              </DropdownMenuLabel>
              {tenants.map((tenant, index) => (
                <DropdownMenuItem
                  key={tenant.name}
                  onClick={() => switchActiveTenant(tenant)}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    {/* <team.logo className="size-3.5 shrink-0" /> */}
                  </div>
                  {tenant.name}
                  <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 p-2">
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Add team
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
