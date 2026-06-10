"use client"

import { useCallback, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import {
  createVendorPurchaseOrder,
  getVendorPurchaseOrders,
  type VendorPORow,
} from "@/lib/actions/vendor-purchase-orders"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import { formatExportDollars } from "@/lib/reports/export-formatters"

import { POTable } from "./purchase-orders/po-table"
import { POViewDialog } from "./purchase-orders/po-view-dialog"
import { POCreateDialog } from "./purchase-orders/po-create-dialog"
import { VendorPOHero } from "./purchase-orders/po-hero"
import { VendorPOControlBar } from "./purchase-orders/po-control-bar"
import { useNewPOForm } from "./purchase-orders/use-new-po-form"
import { poStatusConfig } from "./purchase-orders/types"

// ─── Tab definitions ───────────────────────────────────────────────
// M10 (2026-06-09 audit): only real POStatus values — the phantom
// pending_approval / acknowledged / processing / shipped / fulfilled /
// rejected statuses never exist in the DB, so they matched nothing.

const TAB_KEYS = ["all", "pending", "approved", "in-progress", "fulfilled"] as const
type TabKey = (typeof TAB_KEYS)[number]

const PENDING_STATUSES = new Set(["pending", "draft"])
const APPROVED_STATUSES = new Set(["approved"])
const IN_PROGRESS_STATUSES = new Set(["sent"])
const FULFILLED_STATUSES = new Set(["completed"])

function matchesTab(status: string, tab: TabKey): boolean {
  switch (tab) {
    case "all":
      return true
    case "pending":
      return PENDING_STATUSES.has(status)
    case "approved":
      return APPROVED_STATUSES.has(status)
    case "in-progress":
      return IN_PROGRESS_STATUSES.has(status)
    case "fulfilled":
      return FULFILLED_STATUSES.has(status)
  }
}

const PAGE_SIZE = 50

// ─── Component ─────────────────────────────────────────────────────

interface VendorPurchaseOrdersClientProps {
  vendorId: string
}

export function VendorPurchaseOrdersClient({ vendorId }: VendorPurchaseOrdersClientProps) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabKey>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [facilityFilter, setFacilityFilter] = useState<string>("all")
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selectedPO, setSelectedPO] = useState<VendorPORow | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isAddPODialogOpen, setIsAddPODialogOpen] = useState(false)

  const form = useNewPOForm(vendorId)

  // ─── Queries ───────────────────────────────────────────────────
  // H3 (2026-06-09 audit): server-paginated list + server aggregates
  // (count, totalValue sum, per-status counts) replace the old bare
  // take:50 + client-side reduces over the truncated rows.

  const { data, isLoading } = useQuery({
    queryKey: ["vendorPOs", vendorId, page],
    queryFn: () => getVendorPurchaseOrders({ page, pageSize: PAGE_SIZE }),
  })

  const createMutation = useMutation({
    mutationFn: createVendorPurchaseOrder,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["vendorPOs", vendorId] })
      toast.success("Purchase Order Submitted", {
        description: `${result.poNumber} sent to ${result.facilityName} for approval`,
      })
      form.resetForm()
      setIsAddPODialogOpen(false)
    },
    onError: (err) => {
      toast.error("Failed to create PO", {
        description: err instanceof Error ? err.message : "Unknown error",
      })
    },
  })

  // ─── Derived data ─────────────────────────────────────────────

  const orders = data?.orders ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const statusCounts = data?.statusCounts

  const heroStats = {
    totalPOs: total,
    totalValue: data?.totalValue ?? 0,
    pendingApproval: (statusCounts?.pending ?? 0) + (statusCounts?.draft ?? 0),
    fulfilled: statusCounts?.completed ?? 0,
    // M10: "cancelled" counts status === "cancelled" (the phantom
    // "rejected" status never existed).
    cancelled: statusCounts?.cancelled ?? 0,
  }

  const tabCounts = {
    all: total,
    pending: (statusCounts?.pending ?? 0) + (statusCounts?.draft ?? 0),
    approved: statusCounts?.approved ?? 0,
    "in-progress": statusCounts?.sent ?? 0,
    fulfilled: statusCounts?.completed ?? 0,
  }

  const uniqueFacilities = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const po of orders) {
      if (po.facilityId && !map.has(po.facilityId)) {
        map.set(po.facilityId, { id: po.facilityId, name: po.facilityName })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [orders])

  const filteredOrders = useMemo(() => {
    const search = searchQuery.trim().toLowerCase()
    return orders.filter((po) => {
      if (!matchesTab(po.status, tab)) return false
      if (statusFilter !== "all" && po.status !== statusFilter) return false
      if (facilityFilter !== "all" && po.facilityId !== facilityFilter) return false
      if (search) {
        const haystack = `${po.poNumber} ${po.facilityName}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [orders, tab, statusFilter, facilityFilter, searchQuery])

  // ─── Submit ────────────────────────────────────────────────────

  const handleCreatePO = () => {
    if (!form.newPOFacility) {
      toast.error("Please select a facility")
      return
    }
    if (!form.newPODate) {
      toast.error("Please select a PO date")
      return
    }
    if (form.newPOLineItems.length === 0) {
      toast.error("Please add at least one product")
      return
    }

    createMutation.mutate({
      facilityId: form.newPOFacility,
      contractId: form.selectedFacilityObj?.contractId ?? undefined,
      orderDate: form.newPODate,
      lineItems: form.newPOLineItems.map((item) => ({
        sku: item.sku,
        inventoryDescription: item.productName,
        vendorItemNo: item.vendorItemNo,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        uom: item.uom,
        isOffContract: item.isException ?? false,
      })),
    })
  }

  // ─── Export ────────────────────────────────────────────────────
  // L17: use the canonical toCSV helper (RFC-4180 quoting) like the
  // facility side, instead of a hand-rolled join(",").

  const handleExportCSV = () => {
    if (filteredOrders.length === 0) {
      toast.info("No purchase orders to export.")
      return
    }
    const csv = toCSV({
      columns: [
        { key: "poNumber", label: "PO Number" },
        { key: "facilityName", label: "Facility" },
        {
          key: "status",
          label: "Status",
          format: (v) => poStatusConfig[String(v)]?.label ?? String(v),
        },
        {
          key: "totalCost",
          label: "Amount",
          format: (v) => {
            const n = typeof v === "number" ? v : Number(v ?? 0)
            return Number.isFinite(n) ? formatExportDollars(n) : ""
          },
        },
        { key: "orderDate", label: "Order Date" },
      ],
      rows: filteredOrders as unknown as Record<string, unknown>[],
    })
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = buildReportFilename("Purchase Orders")
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Export complete", {
      description:
        total > orders.length
          ? `${filteredOrders.length} purchase orders exported (current page of ${total} total)`
          : `${filteredOrders.length} purchase orders exported to CSV`,
    })
  }

  const handleViewPO = useCallback((po: VendorPORow) => {
    setSelectedPO(po)
    setIsViewDialogOpen(true)
  }, [])

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <VendorPOHero
        totalPOs={heroStats.totalPOs}
        totalValue={heroStats.totalValue}
        pendingApproval={heroStats.pendingApproval}
        fulfilled={heroStats.fulfilled}
        cancelled={heroStats.cancelled}
        isLoading={isLoading}
      />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabTriggerWithCount value="all" label="All" count={tabCounts.all} />
          <TabTriggerWithCount
            value="pending"
            label="Pending"
            count={tabCounts.pending}
          />
          <TabTriggerWithCount
            value="approved"
            label="Approved"
            count={tabCounts.approved}
          />
          <TabTriggerWithCount
            value="in-progress"
            label="In Progress"
            count={tabCounts["in-progress"]}
          />
          <TabTriggerWithCount
            value="fulfilled"
            label="Fulfilled"
            count={tabCounts.fulfilled}
          />
        </TabsList>
      </Tabs>

      <VendorPOControlBar
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        facilityId={facilityFilter}
        onFacilityIdChange={setFacilityFilter}
        facilities={uniqueFacilities}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onExportCSV={handleExportCSV}
        onAddPO={() => setIsAddPODialogOpen(true)}
      />

      <POTable data={filteredOrders} isLoading={isLoading} onViewPO={handleViewPO} />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
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

      <POViewDialog
        open={isViewDialogOpen}
        onOpenChange={setIsViewDialogOpen}
        selectedPO={selectedPO}
      />

      <POCreateDialog
        open={isAddPODialogOpen}
        onOpenChange={(open) => {
          setIsAddPODialogOpen(open)
          if (!open) form.resetForm()
        }}
        facility={form.newPOFacility}
        onFacilityChange={form.setNewPOFacility}
        poType={form.newPOType}
        onPOTypeChange={form.setNewPOType}
        poDate={form.newPODate}
        onPODateChange={form.setNewPODate}
        facilities={form.facilities}
        selectedFacilityObj={form.selectedFacilityObj}
        facilityProducts={form.facilityProducts}
        displayedFacilityProducts={form.displayedFacilityProducts}
        displayedCatalogProducts={form.displayedCatalogProducts}
        filteredFacilityProductsCount={form.filteredFacilityProductsCount}
        filteredCatalogProductsCount={form.filteredCatalogProductsCount}
        lineItems={form.newPOLineItems}
        lineItemsTotal={form.newPOTotal}
        searchTerm={form.searchTerm}
        selectedProductToAdd={form.selectedProductToAdd}
        onSelectedProductToAddChange={form.setSelectedProductToAdd}
        productSearch={form.productSearch}
        onProductSearchChange={form.setProductSearch}
        addMethod={form.addMethod}
        onAddMethodChange={form.setAddMethod}
        scanInput={form.scanInput}
        onScanInputChange={form.setScanInput}
        showExceptionForm={form.showExceptionForm}
        exceptionProduct={form.exceptionProduct}
        onExceptionProductChange={form.setExceptionProduct}
        onAddLineItem={form.handleAddLineItem}
        onScanProduct={form.handleScanProduct}
        onScanKeyPress={form.handleScanKeyPress}
        onAddException={form.handleAddException}
        onCancelException={form.handleCancelException}
        onCameraScan={form.handleCameraScan}
        onUpdateQuantity={form.handleUpdateQuantity}
        onUpdateLotSn={form.handleUpdateLotSn}
        onRemoveLineItem={form.handleRemoveLineItem}
        onCreatePO={handleCreatePO}
        isCreating={createMutation.isPending}
      />
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────

function TabTriggerWithCount({
  value,
  label,
  count,
}: {
  value: TabKey
  label: string
  count: number
}) {
  return (
    <TabsTrigger value={value} className="gap-2">
      {label}
      <Badge variant="secondary" className="h-5 px-1.5 text-[11px] tabular-nums">
        {count}
      </Badge>
    </TabsTrigger>
  )
}
