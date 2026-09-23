"use client"

import * as React from "react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible"
import {
  Coins,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  ShelvingUnit,
  User,
  Siren,
  Blocks,
  ShoppingBasket,
  MapPinned,
  UserRound,
  ShieldCog,
  Wrench,
  LayoutGrid,
} from "lucide-react"
import { authClient } from "@/lib/auth-client"
import { cn } from "@/lib/utils"
import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import Image from "next/image"
import { UserAvatarProps, UserAvatar } from "./user-avatar"
import { useSession } from "@/lib/session-provider"
import { TeamSwitcher } from "./team-switcher"
import { PermissionKey } from "@vmaas/shared/types"
import { Badge } from "./ui/badge"

interface NavItem {
  title: string
  url?: string
  icon?: React.ReactNode
  requiredPermission?: PermissionKey
  /** Only shown to super admins */
  superAdminOnly?: boolean
  feature?: "brew-log"
  items?: {
    title: string
    url: string
    icon?: React.ReactNode
    requiredPermission?: PermissionKey
    /** Only shown to super admins */
    superAdminOnly?: boolean
    feature?: "brew-log"
  }[]
}

interface AppSidebarProps {
  versions: string[]
  navMain: NavItem[]
}

const data: AppSidebarProps = {
  versions: ["1.0.1", "1.1.0-alpha", "2.0.0-beta1"],
  navMain: [
    {
      title: "Dashboard",
      url: "/",
      icon: <LayoutDashboard />,
    },
    {
      title: "Sales",
      url: "/sales",
      icon: <Coins />,
    },
    {
      title: "Management",
      icon: <ShelvingUnit />,

      items: [
        {
          title: "Machines",
          url: "/machines",

          icon: <Blocks />,
        },
        {
          title: "Products",
          url: "/products",

          icon: <ShoppingBasket />,
        },
        {
          title: "Sites",
          url: "/sites",

          icon: <MapPinned />,
        },
        {
          title: "Machine alerts",
          url: "/machines/alerts",
          icon: <Siren />,
        },
      ],
    },
    {
      title: "Access",
      icon: <ShelvingUnit />,

      items: [
        {
          title: "Users",
          url: "/users",
          requiredPermission: "user:view",
          icon: <UserRound />,
        },
        // {
        //   title: "Permissions",
        //   url: "/permissions",
        //   icon: <ArrowRightLeft />,
        // },
        {
          title: "Roles",
          url: "/roles",
          requiredPermission: "role:view",
          icon: <ShieldCog />,
        },
      ],
    },
    {
      title: "Super admin",
      icon: <Wrench />,
      superAdminOnly: true,

      items: [
        {
          title: "Set up machines",
          url: "/create-machine",
          icon: <LayoutGrid />,
        },
      ],
    },
  ],
}

type NavVisibility = Pick<NavItem, "requiredPermission" | "superAdminOnly">

/**
 * The navigation the user is allowed to see. Filtered before rendering, so a group's
 * item count (which decides between a single link and a collapsible group) only counts
 * visible items, and a group whose items are all hidden disappears entirely.
 */
function getVisibleNavItems(
  items: NavItem[],
  canSee: (item: NavVisibility) => boolean
): NavItem[] {
  return items
    .filter(canSee)
    .map((item) =>
      item.items ? { ...item, items: item.items.filter(canSee) } : item
    )
    .filter((item) => item.items === undefined || item.items.length > 0)
}

const SIDEBAR_OPEN_GROUPS_STORAGE_KEY = "app-sidebar:open-groups"
const EMPTY_PERMISSIONS: string[] = []

function readSidebarOpenGroups(): Record<string, boolean> {
  if (typeof window === "undefined") return {}

  try {
    const raw = localStorage.getItem(SIDEBAR_OPEN_GROUPS_STORAGE_KEY)
    if (!raw) return {}

    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }

    return Object.entries(parsed).reduce<Record<string, boolean>>(
      (state, [title, isOpen]) => {
        if (typeof isOpen === "boolean") {
          state[title] = isOpen
        }

        return state
      },
      {}
    )
  } catch {
    return {}
  }
}

function writeSidebarOpenGroups(state: Record<string, boolean>) {
  try {
    localStorage.setItem(SIDEBAR_OPEN_GROUPS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore quota and browser storage errors.
  }
}

function buildSidebarOpenGroupsState(
  groupTitles: string[],
  currentState: Record<string, boolean>,
  storedState: Record<string, boolean>
) {
  return groupTitles.reduce<Record<string, boolean>>((state, title) => {
    state[title] = currentState[title] ?? storedState[title] ?? true
    return state
  }, {})
}

function SidebarNavigationSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenuItem>
      </SidebarMenu>

      <SidebarMenu className="gap-1">
        <SidebarMenuItem>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuSkeleton className="ml-6 h-7" />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuSkeleton className="ml-6 h-7" />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuSkeleton className="ml-6 h-7" />
        </SidebarMenuItem>
      </SidebarMenu>

      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenuItem>
      </SidebarMenu>

      <SidebarMenu className="gap-1">
        <SidebarMenuItem>
          <SidebarMenuSkeleton showIcon />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuSkeleton className="ml-6 h-7" />
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuSkeleton className="ml-6 h-7" />
        </SidebarMenuItem>
      </SidebarMenu>
    </div>
  )
}

export function AppSidebarSkeleton() {
  return (
    <Sidebar variant="inset">
      <SidebarHeader className="flex justify-between">
        <h1 className="text-lg font-bold">VMaaS</h1>
      </SidebarHeader>
      <SidebarContent className="gap-0">
        <SidebarNavigationSkeleton />
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuSkeleton showIcon />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname()
  const currentPath = pathname || "/"
  const { user, hasPermission, subscriptionStatus } = useSession()

  const navItems = getVisibleNavItems(
    data.navMain,
    (item) =>
      (!item.superAdminOnly || user.isSuperAdmin === true) &&
      (!item.requiredPermission || hasPermission(item.requiredPermission))
  )
  const [hasMounted, setHasMounted] = React.useState(false)
  React.useEffect(() => setHasMounted(true), [])

  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(
    {}
  )
  const shouldShowNavSkeleton = !hasMounted

  const handleOpenGroupChange = React.useCallback(
    (title: string, isOpen: boolean) => {
      setOpenGroups((current) => {
        const nextState = {
          ...current,
          [title]: isOpen,
        }

        writeSidebarOpenGroups(nextState)

        return nextState
      })
    },
    []
  )

  return (
    <Sidebar {...props}>
      <SidebarHeader className="m-0 mb-4 flex justify-between p-0">
        <div className="flex items-center gap-2">
          <Link href="/" className="h-max items-center">
            <h1 className="text-lg font-bold">VMaaS</h1>
          </Link>
          <Link href="/account" className="flex h-max items-center gap-2">
            {subscriptionStatus === "trialing" && (
              <Badge variant="outline" className="text-xs outline-1">
                Trial
              </Badge>
            )}
          </Link>
        </div>
        <TeamSwitcher />
        {process.env["NEXT_PUBLIC_APP_VERSION"] && (
          <Link href="/release-notes" className="text-xs text-muted-foreground">
            {process.env["NEXT_PUBLIC_APP_VERSION"]}
          </Link>
        )}
      </SidebarHeader>
      <SidebarContent className="gap-0">
        {/* We create a collapsible SidebarGroup for each parent. */}
        {shouldShowNavSkeleton ? (
          <SidebarNavigationSkeleton />
        ) : (
          navItems.map((item) => (
            <div key={item.title}>
              {item.items === undefined || item.items?.length === 0 ? (
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className={cn(
                        currentPath === item.url
                          ? "bg-primary! text-primary-foreground!"
                          : "",
                        "text-sm"
                      )}
                      isActive={currentPath === item.url}
                      render={<Link href={item.url || "#"} />}
                    >
                      {item.icon}
                      {item.title}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              ) : null}
              {item.items !== undefined && item.items.length === 1 ? (
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      className={cn(
                        currentPath === item.items[0]?.url
                          ? "bg-primary! text-primary-foreground!"
                          : "",
                        "text-sm"
                      )}
                      isActive={currentPath === item.items[0]?.url}
                      render={<Link href={item.items[0]?.url || "#"} />}
                    >
                      {item.icon}
                      {item.title}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              ) : null}
              {item.items !== undefined && item.items.length > 1 ? (
                <Collapsible
                  open={openGroups[item.title] ?? true}
                  onOpenChange={(isOpen) =>
                    handleOpenGroupChange(item.title, isOpen)
                  }
                  className="group/collapsible"
                >
                  <SidebarMenu>
                    <SidebarMenuItem>
                      <CollapsibleTrigger
                        render={<SidebarMenuButton className="text-sm" />}
                      >
                        {item.icon}
                        {item.title}
                        <ChevronRight className="ml-auto transition-transform group-data-open/collapsible:rotate-90" />
                      </CollapsibleTrigger>
                    </SidebarMenuItem>
                  </SidebarMenu>
                  <CollapsibleContent>
                    <SidebarMenu>
                      {item.items?.map((subItem) => {
                        return (
                          <SidebarMenuItem key={subItem.title} className="pl-4">
                            <SidebarMenuButton
                              className={cn(
                                currentPath === subItem.url
                                  ? "bg-primary! text-primary-foreground!"
                                  : "",
                                "text-sm"
                              )}
                              isActive={currentPath === subItem.url}
                              render={<Link href={subItem.url} />}
                            >
                              {subItem.icon && (
                                <span className="mr-2">{subItem.icon}</span>
                              )}
                              {subItem.title}
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
            </div>
          ))
        )}
      </SidebarContent>
      <SidebarFooter>
        <NavBarFooter data={user} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export function NavBarFooter({ data }: { data: UserAvatarProps }) {
  const router = useRouter()

  const { isMobile } = useSidebar()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
              />
            }
          >
            <UserAvatar data={data} />

            <MoreHorizontal className="" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel>Min konto</DropdownMenuLabel>
              <DropdownMenuItem render={<Link href="/account" />}>
                <User className="size-4" />
                Konto
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                onClick={async () => {
                  await authClient.signOut()
                  router.push("/login")
                  router.refresh()
                }}
              >
                <LogOut className="size-4" />
                Log ud
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
