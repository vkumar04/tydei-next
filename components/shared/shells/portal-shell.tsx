"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import type { NavItem, PortalRole, BadgeCounts } from "@/lib/types"
import {
  Building2,
  FileText,
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
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sidebar-primary">
                <FileText className="h-5 w-5 text-sidebar-primary-foreground" />
              </div>
              <div className="flex flex-col">
                <span className="text-sm font-semibold text-sidebar-foreground">
                  TYDEi
                </span>
                <span className="text-xs text-sidebar-foreground/70">
                  Platform
                </span>
              </div>
            </Link>
          </div>
          {/* Facility / Organization Selector — falls back to a portal badge
              when the portal layout doesn't provide a custom selector */}
          <div className="border-b border-sidebar-border px-4 py-3">
            {sidebarHeader ?? (
              <Badge
                variant="secondary"
                className="bg-sidebar-accent text-sidebar-accent-foreground"
              >
                {role === "admin" ? (
                  <Shield className="mr-1 h-3 w-3" />
                ) : (
                  <Building2 className="mr-1 h-3 w-3" />
                )}
                {role === "facility"
                  ? "Facility Portal"
                  : role === "vendor"
                    ? "Vendor Portal"
                    : "Admin Portal"}
              </Badge>
            )}
          </div>
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
        <header className="flex h-16 items-center gap-4 border-b bg-card px-4 lg:px-6">
          <SidebarTrigger className="-ml-1" />

          {/* Search — opens Cmd+K command palette */}
          <div className="flex-1 lg:max-w-md">
            <CommandSearch />
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-1">
            {/* Import button — opens mass upload dialog */}
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
            {/* Alerts bell — polls for new alerts every 30s */}
            <AlertBell
              role={role}
              facilityId={facilityId}
              vendorId={vendorId}
              initialCount={alertCount}
            />
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
