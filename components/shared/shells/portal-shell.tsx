"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import type { NavItem, PortalRole, BadgeCounts } from "@/lib/types"
import { FileText, Search, Bell, Upload } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SidebarNav } from "@/components/shared/shells/sidebar-nav"
import { UserMenu } from "@/components/shared/shells/user-menu"
import { ThemeToggle } from "@/components/shared/theme-toggle"

interface PortalShellProps {
  role: PortalRole
  navItems: NavItem[]
  user: { name: string; email: string; image?: string | null }
  badgeCounts?: BadgeCounts
  sidebarHeader?: ReactNode
  alertCount?: number
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
  alertCount,
  children,
}: PortalShellProps) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
              <FileText className="h-4 w-4 text-sidebar-primary-foreground" />
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
        <header className="flex h-16 items-center gap-2 border-b bg-card px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mx-2 h-4" />
          {/* Search bar */}
          <div className="relative hidden lg:block lg:max-w-md lg:flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search contracts, vendors..."
              className="pl-9 h-9"
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Import button */}
            <Button variant="outline" size="sm" className="hidden sm:flex gap-2">
              <Upload className="h-4 w-4" />
              Import
            </Button>
            {/* Alerts bell */}
            <Button variant="ghost" size="icon" className="relative" asChild>
              <Link href={role === "vendor" ? "/vendor/alerts" : "/dashboard/alerts"}>
                <Bell className="h-4 w-4" />
                {(alertCount ?? 0) > 0 && (
                  <Badge className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive p-0 text-[10px] text-destructive-foreground">
                    {alertCount}
                  </Badge>
                )}
              </Link>
            </Button>
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
