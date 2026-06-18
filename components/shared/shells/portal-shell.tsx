"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import type { NavItem, PortalRole, BadgeCounts } from "@/lib/types"
import {
  Shield,
  Upload,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarNav } from "@/components/shared/shells/sidebar-nav"
import { UserMenu } from "@/components/shared/shells/user-menu"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { CommandSearch } from "@/components/shared/shells/command-search"
import { AlertBell } from "@/components/shared/shells/alert-bell"
import { NotificationBell } from "@/components/shared/notification-bell"
import { MassUpload } from "@/components/import/mass-upload"

interface PortalShellProps {
  role: PortalRole
  navItems: NavItem[]
  user: { name: string; email: string; image?: string | null }
  badgeCounts?: BadgeCounts
  sidebarHeader?: ReactNode
  alertCount?: number
  facilityId?: string
  vendorId?: string
  children: ReactNode
}

export function PortalShell({
  role,
  navItems,
  user,
  badgeCounts,
  sidebarHeader,
  alertCount,
  facilityId,
  vendorId,
  children,
}: PortalShellProps) {
  const [importDialogOpen, setImportDialogOpen] = useState(false)

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="p-0">
          {/* Logo */}
          <div className="flex h-16 items-center gap-2 border-b border-sidebar-border px-4">
            <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
              {/* Canonical brand mark — matches the marketing header
                  (Vick 2026-06-18: portal had drifted to a FileText icon). */}
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg">
                <span className="text-base font-bold text-primary-foreground">T</span>
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-sidebar-foreground">
                  TYDEi
                </span>
                <span className="text-xs text-sidebar-foreground/70">
                  Healthcare Platform
                </span>
              </div>
            </Link>
          </div>
          {/* Facility / Organization selector when a portal layout provides
              one. The redundant "Facility/Vendor Portal" badge was removed
              (Vick 2026-06-18); admin keeps its portal badge. The block only
              renders when there's something to show, so there's no empty
              bordered strip below the logo. */}
          {(sidebarHeader || role === "admin") && (
            <div className="border-b border-sidebar-border px-4 py-3">
              {sidebarHeader ?? (
                <Badge
                  variant="secondary"
                  className="bg-sidebar-accent text-sidebar-accent-foreground"
                >
                  <Shield className="mr-1 h-3 w-3" />
                  Admin Portal
                </Badge>
              )}
            </div>
          )}
        </SidebarHeader>
        <SidebarContent className="p-0">
          <ScrollArea className="flex-1 px-3 py-4">
            <SidebarNav items={navItems} badgeCounts={badgeCounts} />
          </ScrollArea>
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-4">
          <UserMenu user={user} role={role} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        {/* Charles UI cleanup: 3-zone top bar — sidebar trigger pinned
            left, global search centered, all actions clustered right.
            The two bell icons were visually identical; AlertBell now
            uses TriangleAlert (warnings/expirations/discrepancies) so
            it's distinguishable from NotificationBell (in-app
            notification feed) at a glance. */}
        <header className="grid h-16 grid-cols-[auto_1fr_auto] items-center gap-4 border-b bg-card px-4 lg:px-6">
          {/* LEFT — sidebar collapse */}
          <SidebarTrigger className="-ml-1" />

          {/* CENTER — global search (Cmd+K palette spans every entity) */}
          <div className="mx-auto w-full max-w-xl">
            <CommandSearch />
          </div>

          {/* RIGHT — actions cluster */}
          <div className="flex items-center gap-1 justify-self-end">
            <Button
              variant="outline"
              size="sm"
              className="hidden md:flex"
              onClick={() => setImportDialogOpen(true)}
            >
              <Upload className="mr-2 h-4 w-4" />
              Import Data
            </Button>
            <MassUpload
              facilityId={facilityId ?? ""}
              open={importDialogOpen}
              onOpenChange={setImportDialogOpen}
            />
            <ThemeToggle />
            {/* Alerts (triangle): off-contract purchases, price
                discrepancies, expirations. Polls every 30s. */}
            <AlertBell
              role={role}
              facilityId={facilityId}
              vendorId={vendorId}
              initialCount={alertCount}
            />
            {/* In-app notifications (bell): pending-contract decisions
                + change-proposal events. Distinct icon from AlertBell
                so users can tell at a glance which one's lit. */}
            <NotificationBell />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-secondary/30">
          <div className="container mx-auto p-4 lg:p-6">
            {children}
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
