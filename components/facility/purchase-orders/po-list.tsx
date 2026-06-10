"use client"

import { useMemo, useState } from "react"
import { Plus, ShoppingCart } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  usePurchaseOrders,
  usePOStats,
  useUpdatePOStatus,
  useFacilityVendors,
} from "@/hooks/use-purchase-orders"
import { POCreateDialog } from "./po-create-form"
import { POHero } from "./po-hero"
import { POControlBar } from "./po-control-bar"
import { POTable, type POTableRow } from "./po-table"
import { toast } from "sonner"
import type { POStatus } from "@/lib/generated/prisma/client"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import {
  formatExportDate,
  formatExportDollars,
} from "@/lib/reports/export-formatters"

interface POListProps {
  facilityId: string
}

type TabValue = "all" | "on-contract" | "off-contract" | "pending"

const PAGE_SIZE = 50

export function POList({ facilityId }: POListProps) {
  const [tab, setTab] = useState<TabValue>("all")
  const [status, setStatus] = useState<POStatus | "all">("all")
  const [vendorId, setVendorId] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [newPOOpen, setNewPOOpen] = useState(false)
  const [page, setPage] = useState(1)

  // H2 (2026-06-09 audit): the list is server-paginated; hero KPIs and tab
  // counts come from server aggregates (getPOStats) instead of reducing
  // over the fetched page rows, which silently truncated past page 1.
  const { data, isLoading } = usePurchaseOrders(facilityId, {
    status: status === "all" ? undefined : status,
    vendorId: vendorId === "all" ? undefined : vendorId,
    page,
    pageSize: PAGE_SIZE,
  })
  const { data: stats, isLoading: statsLoading } = usePOStats(facilityId)
  const { data: vendors } = useFacilityVendors(facilityId)
  const updateStatus = useUpdatePOStatus()

  const orders = (data?.orders ?? []) as POTableRow[]
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const handleStatusChange = (next: POStatus | "all") => {
    setStatus(next)
    setPage(1)
  }
  const handleVendorIdChange = (next: string) => {
    setVendorId(next)
    setPage(1)
  }

  // ─── Tab counts (server aggregates — never shift with filters) ────
  const tabCounts = {
    all: stats?.totalPOs ?? 0,
    onContract: stats?.onContractCount ?? 0,
    offContract: stats?.offContractCount ?? 0,
    pending: stats?.statusCounts?.pending ?? 0,
  }

  // ─── Filtering: tab + search (within the current page) ────────────
  const visibleOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return orders.filter((po) => {
      if (tab === "on-contract" && !po.contract) return false
      if (tab === "off-contract" && po.contract) return false
      if (tab === "pending" && po.status !== "pending") return false
      if (q) {
        if (
          !po.poNumber.toLowerCase().includes(q) &&
          !po.vendor.name.toLowerCase().includes(q)
        ) {
          return false
        }
      }
      return true
    })
  }, [orders, tab, searchQuery])

  const isEmpty =
    !statsLoading &&
    stats !== undefined &&
    stats.totalPOs === 0

  const vendorList = (vendors ?? []).map(
    (v: { id: string; name: string }) => ({ id: v.id, name: v.name }),
  )

  const handleExport = () => {
    if (visibleOrders.length === 0) {
      toast.info("No purchase orders to export.")
      return
    }
    const exportRows: Record<string, unknown>[] = visibleOrders.map((po) => ({
      poNumber: po.poNumber,
      vendorName: po.vendor?.name ?? "",
      contractName: po.contract?.name ?? "",
      status: po.status,
      orderDate: po.orderDate,
      lineItems: po._count?.lineItems ?? 0,
      totalCost: po.totalCost,
    }))
    const csv = toCSV({
      columns: [
        { key: "poNumber", label: "PO #" },
        { key: "vendorName", label: "Vendor" },
        { key: "contractName", label: "Contract" },
        { key: "status", label: "Status" },
        {
          key: "orderDate",
          label: "Order Date",
          format: (v) => {
            if (!v) return ""
            const d = v instanceof Date ? v : new Date(v as string)
            return formatExportDate(d)
          },
        },
        {
          key: "lineItems",
          label: "Line Items",
          format: (v) => String(v ?? 0),
        },
        {
          key: "totalCost",
          label: "Total Cost",
          format: (v) => {
            const n = typeof v === "number" ? v : Number(v ?? 0)
            return Number.isFinite(n) ? formatExportDollars(n) : ""
          },
        },
      ],
      rows: exportRows,
    })
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = buildReportFilename("Purchase Orders")
    a.click()
    URL.revokeObjectURL(url)
    // H2: the export covers the currently fetched page — say so when
    // there are more rows on other pages.
    toast.success(
      total > orders.length
        ? `Exported ${exportRows.length} purchase orders (current page of ${total} total)`
        : `Exported ${exportRows.length} purchase orders`,
    )
  }

  return (
    <div className="space-y-6">
      <POHero
        totalPOs={stats?.totalPOs ?? 0}
        onContractSpend={stats?.onContractSpend ?? 0}
        offContractSpend={stats?.offContractSpend ?? 0}
        pendingApproval={stats?.pendingApproval ?? 0}
        totalValue={stats?.totalValue ?? 0}
        isLoading={statsLoading}
      />

      {isEmpty ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="rounded-full bg-muted p-4 mb-4">
              <ShoppingCart className="size-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">
              No purchase orders yet
            </h3>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first purchase order to get started.
            </p>
            <Button onClick={() => setNewPOOpen(true)}>
              <Plus className="size-4" /> Create PO
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <POControlBar
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            status={status}
            onStatusChange={handleStatusChange}
            vendorId={vendorId}
            onVendorIdChange={handleVendorIdChange}
            vendors={vendorList}
            onExport={handleExport}
            exportDisabled={isLoading || visibleOrders.length === 0}
            onNewPO={() => setNewPOOpen(true)}
          />

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList>
              <TabsTrigger value="all">
                All ({tabCounts.all})
              </TabsTrigger>
              <TabsTrigger value="on-contract">
                On Contract ({tabCounts.onContract})
              </TabsTrigger>
              <TabsTrigger value="off-contract">
                Off Contract ({tabCounts.offContract})
              </TabsTrigger>
              <TabsTrigger value="pending">
                Pending ({tabCounts.pending})
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Card>
            <CardContent className="pt-6">
              <POTable
                orders={visibleOrders}
                isLoading={isLoading}
                onUpdateStatus={(id, next) =>
                  updateStatus.mutate({ id, status: next })
                }
              />
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t pt-4 mt-4">
                  <p className="text-sm text-muted-foreground">
                    Page {page} of {totalPages} · {total} orders
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1 || isLoading}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages || isLoading}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <POCreateDialog
        facilityId={facilityId}
        vendors={vendorList}
        open={newPOOpen}
        onOpenChange={setNewPOOpen}
      />
    </div>
  )
}
