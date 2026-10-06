"use client"

import { ChevronsUpDown } from "lucide-react"
import { FallbackAvatar } from "./fallback-avatar"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useSession } from "@/lib/session-provider"
import { switchTenant } from "@/app/(protected)/actions"
import { toast } from "sonner"

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const { tenants, activeTenantId } = useSession()
  const activeTenant =
    tenants.find((tenant) => tenant.id === activeTenantId) ?? null

  if (tenants.length === 0) return null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Offset copy of the trigger's shape, peeking out 5px below it to
            give the button a sharp primary under-border. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-11.5 translate-y-1.25 rounded-md bg-primary group-data-[collapsible=icon]:size-8"
        />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="relative z-10 border bg-sidebar data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar text-background dark:bg-foreground">
                  <FallbackAvatar seed={activeTenant?.id ?? ""} />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {activeTenant?.name}
                  </span>
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
                Teneants
              </DropdownMenuLabel>
              {tenants.map((tenant) => (
                <DropdownMenuItem
                  key={tenant.name}
                  onClick={async () => {
                    const [error] = await switchTenant(tenant.id)
                    if (error) {
                      toast.error(
                        "Failed to switch tenant - status: " + error.status
                      )
                    }
                    location.reload()
                  }}
                  className="gap-2 p-2"
                >
                  <div className="flex size-6 items-center justify-center rounded-md border">
                    <FallbackAvatar seed={tenant?.id ?? ""} />
                  </div>
                  {tenant.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
