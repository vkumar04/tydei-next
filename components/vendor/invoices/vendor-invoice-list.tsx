"use client"

import { useMemo, useState } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Building2,
  CalendarDays,
  Download,
  Eye,
  Hash,
  MoreHorizontal,
  Send,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { DataTable } from "@/components/shared/tables/data-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDeleteInvoice, useVendorInvoices } from "@/hooks/use-invoices"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { v0InvoicePriority } from "@/lib/v0-spec/invoice-validation"
import { VendorInvoiceControlBar } from "./vendor-invoice-control-bar"
import { VendorInvoiceDetailDialog } from "./vendor-invoice-detail-dialog"
import { VendorInvoiceHero } from "./vendor-invoice-hero"
import {
  statusConfig,
  statusTabs,
  type InvoiceRow,
} from "./vendor-invoice-shared"
import { VendorInvoiceSubmitDialog } from "./vendor-invoice-submit-dialog"

interface VendorInvoiceListProps {
  vendorId: string
}

export function VendorInvoiceList({ vendorId }: VendorInvoiceListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false)

  const deleteMut = useDeleteInvoice()

  const { data, isLoading } = useVendorInvoices(vendorId, (statusFilter !== "all" && statusFilter !== "submitted"
      ? { status: statusFilter as never }
      : {}))

  const allInvoices = (data?.invoices as unknown as InvoiceRow[]) ?? []

  // Facility options derived from current result set.
  const facilities = useMemo(() => {
    const map = new Map<string, string>()
    for (const inv of allInvoices) {
      const name = inv.facility?.name
      if (name && !map.has(name)) map.set(name, name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [allInvoices])

  // Apply client-side search + facility + "Sent" tab (draft/submitted/pending alias).
  const invoices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return allInvoices.filter((inv) => {
      if (facilityFilter !== "all" && inv.facility?.name !== facilityFilter) {
        return false
      }
      if (statusFilter === "submitted") {
        if (
          inv.status !== "submitted" &&
          inv.status !== "pending" &&
          inv.status !== "validated"
        ) {
          return false
        }
      }
      if (q.length === 0) return true
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        (inv.facility?.name ?? "").toLowerCase().includes(q)
      )
    })
  }, [allInvoices, facilityFilter, searchQuery, statusFilter])

  // Hero stats derived from the full dataset, not the filtered view.
  const heroStats = useMemo(() => {
    let totalInvoiced = 0
    let paidAmount = 0
    let outstandingAmount = 0
    let disputedCount = 0
    for (const inv of allInvoices) {
      const amt = Number(inv.totalInvoiceCost ?? 0)
      totalInvoiced += amt
      if (inv.status === "paid") paidAmount += amt
      else if (inv.status === "disputed") disputedCount += 1
      else if (
        inv.status === "draft" ||
        inv.status === "submitted" ||
        inv.status === "pending" ||
        inv.status === "validated" ||
        inv.status === "approved"
      ) {
        outstandingAmount += amt
      }
    }
    return {
      totalCount: allInvoices.length,
      totalInvoiced,
      paidAmount,
      outstandingAmount,
      disputedCount,
    }
  }, [allInvoices])

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allInvoices.length }
    let sent = 0
    for (const inv of allInvoices) {
      counts[inv.status] = (counts[inv.status] ?? 0) + 1
      if (
        inv.status === "submitted" ||
        inv.status === "pending" ||
        inv.status === "validated"
      ) {
        sent += 1
      }
    }
    counts.submitted = sent
    return counts
  }, [allInvoices])

  const columns: ColumnDef<InvoiceRow>[] = [
    {
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Hash className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{row.original.invoiceNumber}</span>
        </div>
      ),
    },
    {
      accessorKey: "facility.name",
      header: "Facility",
      accessorFn: (row) => row.facility?.name ?? "N/A",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="truncate max-w-[180px]">
            {row.original.facility?.name ?? "N/A"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "totalInvoiceCost",
      header: "Amount",
      cell: ({ row }) => (
        <span className="font-semibold tabular-nums">
          {formatCurrency(Number(row.original.totalInvoiceCost ?? 0))}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status
        const config = statusConfig[s] ?? statusConfig.pending
        const StatusIcon = config.icon
        return (
          <Badge className={config.color}>
            <StatusIcon className="h-3 w-3 mr-1" />
            {config.label}
          </Badge>
        )
      },
    },
    {
      accessorKey: "invoiceDate",
      header: "Submitted",
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          <span className="text-sm">{formatDate(row.original.invoiceDate)}</span>
        </div>
      ),
    },
    {
      accessorKey: "variance",
      header: "Variance",
      cell: ({ row }) => {
        const variance = row.original.variance
        const pct = row.original.variancePercent
        if (variance === 0 && pct === 0) {
          return <span className="text-sm text-muted-foreground">--</span>
        }
        const isPositive = pct > 0
        const Icon = isPositive ? TrendingUp : TrendingDown
        return (
          <div className="flex items-center gap-1">
            <Icon
              className={`h-3.5 w-3.5 ${isPositive ? "text-red-500" : "text-green-500"}`}
            />
            <span
              className={`text-sm font-medium ${isPositive ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
            >
              {isPositive ? "+" : ""}
              {pct.toFixed(1)}%
            </span>
          </div>
        )
      },
    },
    {
      id: "priority",
      header: "Priority",
      // v0 doc invoice-validation §8: classify by |variance|.
      // |pct| > 5 → high, > 2 → medium, > 0 → low, else none.
      cell: ({ row }) => {
        const pct = row.original.variancePercent ?? 0
        const priority = v0InvoicePriority({ variancePct: pct })
        if (priority === "none")
          return <span className="text-sm text-muted-foreground">—</span>
        const cls =
          priority === "high"
            ? "bg-red-500/15 text-red-600 dark:text-red-400 border-0"
            : priority === "medium"
              ? "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0"
              : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0"
        return (
          <Badge className={cls}>
            {priority.charAt(0).toUpperCase() + priority.slice(1)}
          </Badge>
        )
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                setSelectedInvoice(row.original)
                setViewDialogOpen(true)
              }}
            >
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </DropdownMenuItem>
            {row.original.status === "draft" && (
              <>
                <DropdownMenuItem>
                  <Send className="mr-2 h-4 w-4" />
                  Submit
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteMut.mutate(row.original.id)
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <VendorInvoiceHero stats={heroStats} loading={isLoading} />

      <VendorInvoiceControlBar
        facilities={facilities}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        facilityFilter={facilityFilter}
        onFacilityFilterChange={setFacilityFilter}
        onNewInvoiceClick={() => setSubmitDialogOpen(true)}
      />

      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          {statusTabs.map((tab) => {
            const Icon = tab.icon
            const count = tabCounts[tab.value] ?? 0
            return (
              <TabsTrigger key={tab.value} value={tab.value}>
                <Icon className="h-3.5 w-3.5 mr-1" />
                {tab.label}
                {tab.value !== "all" && count > 0 && (
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({count})
                  </span>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>
      </Tabs>

      <DataTable
        columns={columns}
        data={invoices}
        isLoading={isLoading}
        onRowClick={(row) => {
          setSelectedInvoice(row)
          setViewDialogOpen(true)
        }}
      />

      <VendorInvoiceDetailDialog
        invoice={selectedInvoice}
        open={viewDialogOpen}
        onOpenChange={setViewDialogOpen}
      />

      <VendorInvoiceSubmitDialog
        open={submitDialogOpen}
        onOpenChange={setSubmitDialogOpen}
      />
    </div>
  )
}
