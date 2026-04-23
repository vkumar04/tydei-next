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

import { POTable } from "./purchase-orders/po-table"
import { POViewDialog } from "./purchase-orders/po-view-dialog"
import { POCreateDialog } from "./purchase-orders/po-create-dialog"
import { VendorPOHero } from "./purchase-orders/po-hero"
import { VendorPOControlBar } from "./purchase-orders/po-control-bar"
import { useNewPOForm } from "./purchase-orders/use-new-po-form"
import { poStatusConfig } from "./purchase-orders/types"

// ─── Tab definitions ───────────────────────────────────────────────

const TAB_KEYS = ["all", "pending", "approved", "in-progress", "fulfilled"] as const
type TabKey = (typeof TAB_KEYS)[number]

const PENDING_STATUSES = new Set(["pending_approval", "pending", "draft"])
const APPROVED_STATUSES = new Set(["approved"])
const IN_PROGRESS_STATUSES = new Set([
  "acknowledged",
  "processing",
  "sent",
  "shipped",
])
const FULFILLED_STATUSES = new Set(["fulfilled", "completed"])

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
  const [selectedPO, setSelectedPO] = useState<VendorPORow | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isAddPODialogOpen, setIsAddPODialogOpen] = useState(false)

  const form = useNewPOForm(vendorId)

  // ─── Queries ───────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ["vendorPOs", vendorId],
    queryFn: () => getVendorPurchaseOrders(vendorId),
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

  const allOrders = data ?? []

  const heroStats = useMemo(
    () => ({
      totalPOs: allOrders.length,
      totalValue: allOrders.reduce((sum, po) => sum + po.totalCost, 0),
      pendingApproval: allOrders.filter((po) => PENDING_STATUSES.has(po.status))
        .length,
      fulfilled: allOrders.filter((po) => FULFILLED_STATUSES.has(po.status))
        .length,
      cancelled: allOrders.filter((po) =>
        ["rejected", "cancelled"].includes(po.status)
      ).length,
    }),
    [allOrders]
  )

  const tabCounts = useMemo(
    () => ({
      all: allOrders.length,
      pending: allOrders.filter((po) => matchesTab(po.status, "pending")).length,
      approved: allOrders.filter((po) => matchesTab(po.status, "approved")).length,
      "in-progress": allOrders.filter((po) => matchesTab(po.status, "in-progress"))
        .length,
      fulfilled: allOrders.filter((po) => matchesTab(po.status, "fulfilled")).length,
    }),
    [allOrders]
  )

  const uniqueFacilities = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const po of allOrders) {
      if (po.facilityId && !map.has(po.facilityId)) {
        map.set(po.facilityId, { id: po.facilityId, name: po.facilityName })
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [allOrders])

  const filteredOrders = useMemo(() => {
    const search = searchQuery.trim().toLowerCase()
    return allOrders.filter((po) => {
      if (!matchesTab(po.status, tab)) return false
      if (statusFilter !== "all" && po.status !== statusFilter) return false
      if (facilityFilter !== "all" && po.facilityId !== facilityFilter) return false
      if (search) {
        const haystack = `${po.poNumber} ${po.facilityName}`.toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [allOrders, tab, statusFilter, facilityFilter, searchQuery])

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
      vendorId,
      facilityId: form.newPOFacility,
      contractId: form.selectedFacilityObj?.contractId ?? undefined,
      orderDate: form.newPODate,
      notes: form.newPONotes || undefined,
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

  const handleExportCSV = () => {
    const headers = ["PO Number", "Facility", "Status", "Amount", "Order Date"]
    const rows = filteredOrders.map((po) => [
      po.poNumber,
      po.facilityName,
      poStatusConfig[po.status]?.label ?? po.status,
      po.totalCost.toString(),
      po.orderDate,
    ])
    const csvContent = [headers, ...rows].map((row) => row.join(",")).join("\n")
    const blob = new Blob([csvContent], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `purchase-orders-${new Date().toISOString().split("T")[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Export complete", {
      description: `${filteredOrders.length} purchase orders exported to CSV`,
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
        notes={form.newPONotes}
        onNotesChange={form.setNewPONotes}
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
