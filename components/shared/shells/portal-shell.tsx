"use client"

import type { ReactNode } from "react"
import type { NavItem, PortalRole, BadgeCounts } from "@/lib/types"
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { SidebarNav } from "@/components/shared/shells/sidebar-nav"
import { UserMenu } from "@/components/shared/shells/user-menu"
import { ThemeToggle } from "@/components/shared/theme-toggle"

interface PortalShellProps {
  role: PortalRole
  navItems: NavItem[]
  user: { name: string; email: string; image?: string | null }
  badgeCounts?: BadgeCounts
  sidebarHeader?: ReactNode
  children: ReactNode
}

const portalLabels: Record<PortalRole, string> = {
  facility: "Facility Portal",
  vendor: "Vendor Portal",
  admin: "Admin Portal",
}

export function PortalShell({
  role,
  navItems,
  user,
  badgeCounts,
  sidebarHeader,
  children,
}: PortalShellProps) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
              <span className="text-sm font-bold text-sidebar-primary-foreground">
                T
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-sidebar-foreground">
                TYDEi
              </span>
              <span className="text-xs text-sidebar-foreground/60">
                {portalLabels[role]}
              </span>
            </div>
          </div>
          {sidebarHeader && (
            <>
              <Separator className="my-2 bg-sidebar-border" />
              {sidebarHeader}
            </>
          )}
        </SidebarHeader>
        <SidebarContent>
          <SidebarNav items={navItems} badgeCounts={badgeCounts} />
        </SidebarContent>
        <SidebarFooter className="p-4">
          <UserMenu user={user} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-2 h-4" />
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
