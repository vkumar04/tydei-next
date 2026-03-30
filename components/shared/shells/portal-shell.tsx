"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import type { NavItem, PortalRole, BadgeCounts } from "@/lib/types"
import {
  FileText,
  Search,
  Bell,
  Upload,
  FileSignature,
  DollarSign,
  ArrowRight,
} from "lucide-react"
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
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

export function PortalShell({
  role,
  navItems,
  user,
  badgeCounts,
  sidebarHeader,
  alertCount,
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
          {/* Facility / Organization Selector */}
          {sidebarHeader && (
            <div className="border-b border-sidebar-border px-4 py-3">
              {sidebarHeader}
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
        <header className="flex h-16 items-center gap-4 border-b bg-card px-4 lg:px-6">
          <SidebarTrigger className="-ml-1" />

          {/* Search */}
          <div className="flex-1 lg:max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder="Search contracts, vendors, reports..."
                className="h-9 w-full rounded-lg border bg-background pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          {/* Header actions */}
          <div className="flex items-center gap-1">
            {/* Import button with dialog */}
            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="hidden md:flex">
                  <Upload className="mr-2 h-4 w-4" />
                  Import Data
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Import Data</DialogTitle>
                  <DialogDescription>
                    Choose a data type to import. You will be taken to the
                    appropriate page to upload your files.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-3 py-4">
                  <Link
                    href="/dashboard/cog-data"
                    onClick={() => setImportDialogOpen(false)}
                  >
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                    >
                      <span className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        Import COG Data
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                  <Link
                    href="/dashboard/contracts/new"
                    onClick={() => setImportDialogOpen(false)}
                  >
                    <Button
                      variant="outline"
                      className="w-full justify-between"
                    >
                      <span className="flex items-center gap-2">
                        <FileSignature className="h-4 w-4" />
                        Import Contract
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </DialogContent>
            </Dialog>
            <ThemeToggle />
            {/* Alerts bell */}
            <Link href={role === "vendor" ? "/vendor/alerts" : "/dashboard/alerts"}>
              <Button variant="ghost" size="icon" className="relative h-9 w-9">
                <Bell className="h-4 w-4" />
                {(alertCount ?? 0) > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground">
                    {(alertCount ?? 0) > 9 ? "9+" : alertCount}
                  </span>
                )}
              </Button>
            </Link>
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
