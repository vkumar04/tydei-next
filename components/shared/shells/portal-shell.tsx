"use client"

import { useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { NavItem, PortalRole, BadgeCounts } from "@/lib/types"
import {
  FileText,
  Upload,
  FileSignature,
  DollarSign,
  FileSpreadsheet,
  Layers,
  Sparkles,
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
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SidebarNav } from "@/components/shared/shells/sidebar-nav"
import { UserMenu } from "@/components/shared/shells/user-menu"
import { ThemeToggle } from "@/components/shared/theme-toggle"
import { CommandSearch } from "@/components/shared/shells/command-search"
import { AlertBell } from "@/components/shared/shells/alert-bell"

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
  const router = useRouter()

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

          {/* Search — opens Cmd+K command palette */}
          <div className="flex-1 lg:max-w-md">
            <CommandSearch />
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
              <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <DialogTitle className="text-xl">Import Data</DialogTitle>
                      <DialogDescription>
                        Upload your file and we will automatically detect the data type
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                {/* File dropzone */}
                <Card className="border-2">
                  <CardContent className="pt-6">
                    <div
                      className="border-2 border-dashed rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() =>
                        document.getElementById("import-file-global")?.click()
                      }
                      onDragOver={(e) => {
                        e.preventDefault()
                        e.currentTarget.classList.add(
                          "border-primary",
                          "bg-primary/5"
                        )
                      }}
                      onDragLeave={(e) => {
                        e.currentTarget.classList.remove(
                          "border-primary",
                          "bg-primary/5"
                        )
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        e.currentTarget.classList.remove(
                          "border-primary",
                          "bg-primary/5"
                        )
                        const file = e.dataTransfer.files[0]
                        if (file) {
                          setImportDialogOpen(false)
                          const ext = file.name.split(".").pop()?.toLowerCase()
                          if (ext === "pdf") {
                            router.push("/dashboard/contracts/new")
                          } else {
                            router.push("/dashboard/cog-data?autoImport=true")
                          }
                        }
                      }}
                    >
                      <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                      <p className="text-lg font-medium mb-1">
                        Drop your file here or click to browse
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Supported formats: CSV, Excel (.xlsx, .xls), PDF
                      </p>
                    </div>
                    <input
                      type="file"
                      id="import-file-global"
                      accept=".csv,.xlsx,.xls,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) {
                          setImportDialogOpen(false)
                          const ext = file.name.split(".").pop()?.toLowerCase()
                          if (ext === "pdf") {
                            router.push("/dashboard/contracts/new")
                          } else {
                            router.push("/dashboard/cog-data?autoImport=true")
                          }
                        }
                      }}
                    />
                    <p className="text-sm text-muted-foreground text-center mt-3">
                      <Sparkles className="inline h-3.5 w-3.5 mr-1 text-primary" />
                      The system will automatically detect if this is COG usage
                      data or a pricing file
                    </p>
                  </CardContent>
                </Card>

                {/* Manual data type selection */}
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Or select the data type manually:
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Link
                      href="/dashboard/cog-data"
                      onClick={() => setImportDialogOpen(false)}
                    >
                      <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
                        <CardContent className="flex items-start gap-3 pt-4 pb-4">
                          <DollarSign className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium text-sm">COG Usage Data</p>
                            <p className="text-xs text-muted-foreground">
                              POs, invoices, transactions
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                    <Link
                      href="/dashboard/cog-data?tab=pricing"
                      onClick={() => setImportDialogOpen(false)}
                    >
                      <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
                        <CardContent className="flex items-start gap-3 pt-4 pb-4">
                          <FileSpreadsheet className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium text-sm">Pricing File</p>
                            <p className="text-xs text-muted-foreground">
                              Price lists, catalogs
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                    <Link
                      href="/dashboard/contracts/new"
                      onClick={() => setImportDialogOpen(false)}
                    >
                      <Card className="cursor-pointer hover:border-primary/50 transition-colors h-full">
                        <CardContent className="flex items-start gap-3 pt-4 pb-4">
                          <Layers className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium text-sm">
                              Contract / Mass Upload
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Upload multiple files at once
                            </p>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
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
