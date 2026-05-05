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
import type { POStatus } from "@prisma/client"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import {
  formatExportDate,
  formatExportDollars,
} from "@/lib/reports/export-formatters"

interface POListProps {
  facilityId: string
}

type TabValue = "all" | "on-contract" | "off-contract" | "pending"

export function POList({ facilityId }: POListProps) {
  const [tab, setTab] = useState<TabValue>("all")
  const [status, setStatus] = useState<POStatus | "all">("all")
  const [vendorId, setVendorId] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [newPOOpen, setNewPOOpen] = useState(false)

  const { data, isLoading } = usePurchaseOrders(facilityId, {
    status: status === "all" ? undefined : status,
    vendorId: vendorId === "all" ? undefined : vendorId,
  })
  // Unfiltered orders drive hero KPIs and tab counts so they don't flicker
  // when the user narrows the Status / Vendor filters.
  const { data: allData } = usePurchaseOrders(facilityId, {})
  const { data: stats, isLoading: statsLoading } = usePOStats(facilityId)
  const { data: vendors } = useFacilityVendors(facilityId)
  const updateStatus = useUpdatePOStatus()

  const orders = (data?.orders ?? []) as POTableRow[]
  const allOrders = (allData?.orders ?? []) as POTableRow[]

  // ─── Hero KPIs ─────────────────────────────────────────────────
  const heroStats = useMemo(() => {
    let onContractSpend = 0
    let offContractSpend = 0
    for (const po of allOrders) {
      const amount = Number(po.totalCost ?? 0)
      if (po.contract) onContractSpend += amount
      else offContractSpend += amount
    }
    return { onContractSpend, offContractSpend }
  }, [allOrders])

  const pendingApproval = useMemo(
    () => allOrders.filter((po) => po.status === "pending").length,
    [allOrders],
  )

  // ─── Tab counts (use allOrders so counts never shift with filters) ─
  const tabCounts = useMemo(() => {
    let onContract = 0
    let offContract = 0
    let pending = 0
    for (const po of allOrders) {
      if (po.contract) onContract++
      else offContract++
      if (po.status === "pending") pending++
    }
    return { onContract, offContract, pending }
  }, [allOrders])

  // ─── Filtering: tab + search ───────────────────────────────────
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
    !isLoading &&
    allOrders.length === 0 &&
    status === "all" &&
    vendorId === "all"

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
  }

  return (
    <div className="space-y-6">
      <POHero
        totalPOs={stats?.totalPOs ?? allOrders.length}
        onContractSpend={heroStats.onContractSpend}
        offContractSpend={heroStats.offContractSpend}
        pendingApproval={stats?.pendingApproval ?? pendingApproval}
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
            onStatusChange={setStatus}
            vendorId={vendorId}
            onVendorIdChange={setVendorId}
            vendors={vendorList}
            onExport={handleExport}
            exportDisabled={isLoading || visibleOrders.length === 0}
            onNewPO={() => setNewPOOpen(true)}
          />

          <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
            <TabsList>
              <TabsTrigger value="all">
                All ({allOrders.length})
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
