"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  getVendorPurchaseOrders,
  getVendorFacilities,
  getVendorFacilityProducts,
  searchVendorProducts,
  createVendorPurchaseOrder,
  type VendorPORow,
} from "@/lib/actions/vendor-purchase-orders"
import { toast } from "sonner"

import { POStatsCards } from "./purchase-orders/po-stats-cards"
import { POFilterBar } from "./purchase-orders/po-filter-bar"
import { POTable } from "./purchase-orders/po-table"
import { POViewDialog } from "./purchase-orders/po-view-dialog"
import { POCreateDialog } from "./purchase-orders/po-create-dialog"
import type { POLineItem, POType, POStats } from "./purchase-orders/types"
import { poStatusConfig } from "./purchase-orders/types"

// ─── Component ─────────────────────────────────────────────────────

interface VendorPurchaseOrdersClientProps {
  vendorId: string
}

export function VendorPurchaseOrdersClient({ vendorId }: VendorPurchaseOrdersClientProps) {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedPO, setSelectedPO] = useState<VendorPORow | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)
  const [isAddPODialogOpen, setIsAddPODialogOpen] = useState(false)

  // ─── New PO form state ─────────────────────────────────────────
  const [newPOFacility, setNewPOFacility] = useState("")
  const [newPOType, setNewPOType] = useState<POType>("standard")
  const [newPODate, setNewPODate] = useState("")
  const [newPONotes, setNewPONotes] = useState("")
  const [newPOLineItems, setNewPOLineItems] = useState<POLineItem[]>([])
  const [selectedProductToAdd, setSelectedProductToAdd] = useState("")
  const [productSearch, setProductSearch] = useState("")
  const [addMethod, setAddMethod] = useState<"select" | "scan">("select")
  const [scanInput, setScanInput] = useState("")
  const [showExceptionForm, setShowExceptionForm] = useState(false)
  const [exceptionProduct, setExceptionProduct] = useState({
    sku: "",
    name: "",
    description: "",
    lotSn: "",
    unitPrice: "",
    reason: "",
  })

  // ─── Queries ───────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ["vendorPOs", vendorId],
    queryFn: () => getVendorPurchaseOrders(vendorId),
  })

  const { data: facilities = [] } = useQuery({
    queryKey: ["vendorFacilities", vendorId],
    queryFn: () => getVendorFacilities(vendorId),
  })

  const selectedFacilityObj = facilities.find((f) => f.id === newPOFacility)

  const { data: facilityProducts = [] } = useQuery({
    queryKey: ["vendorFacilityProducts", vendorId, newPOFacility],
    queryFn: () => getVendorFacilityProducts({ vendorId, facilityId: newPOFacility }),
    enabled: !!newPOFacility,
  })

  const { data: searchResults = [] } = useQuery({
    queryKey: ["vendorProductSearch", vendorId, newPOFacility, productSearch],
    queryFn: () =>
      searchVendorProducts({
        vendorId,
        facilityId: newPOFacility || undefined,
        query: productSearch,
      }),
    enabled: productSearch.length >= 2,
  })

  // ─── Derived product lists ─────────────────────────────────────

  const searchTerm = productSearch.toLowerCase().trim()

  const filteredFacilityProducts = useMemo(() => {
    if (!newPOFacility) return []
    if (!searchTerm) return facilityProducts
    return facilityProducts.filter(
      (p) =>
        p.description.toLowerCase().includes(searchTerm) ||
        p.vendorItemNo.toLowerCase().includes(searchTerm) ||
        (p.category ?? "").toLowerCase().includes(searchTerm)
    )
  }, [facilityProducts, searchTerm, newPOFacility])

  const filteredCatalogProducts = useMemo(() => {
    if (searchTerm.length < 2) return []
    const facilityIds = new Set(facilityProducts.map((p) => p.vendorItemNo))
    return searchResults.filter((p) => !facilityIds.has(p.vendorItemNo))
  }, [searchResults, facilityProducts, searchTerm])

  const displayedFacilityProducts = filteredFacilityProducts.slice(0, 50)
  const displayedCatalogProducts = filteredCatalogProducts.slice(
    0,
    Math.max(0, 50 - displayedFacilityProducts.length)
  )

  // ─── Create mutation ───────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: createVendorPurchaseOrder,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["vendorPOs", vendorId] })
      toast.success("Purchase Order Submitted", {
        description: `${result.poNumber} sent to ${result.facilityName} for approval`,
      })
      resetForm()
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

  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return allOrders
    return allOrders.filter((po) => po.status === statusFilter)
  }, [allOrders, statusFilter])

  const stats: POStats = useMemo(
    () => ({
      pendingApproval: allOrders.filter(
        (po) => po.status === "pending_approval" || po.status === "pending"
      ).length,
      approved: allOrders.filter((po) => po.status === "approved").length,
      inProgress: allOrders.filter((po) =>
        ["acknowledged", "processing", "sent", "shipped"].includes(po.status)
      ).length,
      fulfilled: allOrders.filter(
        (po) => po.status === "fulfilled" || po.status === "completed"
      ).length,
      rejected: allOrders.filter(
        (po) => po.status === "rejected" || po.status === "cancelled"
      ).length,
      totalValue: allOrders.reduce((sum, po) => sum + po.totalCost, 0),
    }),
    [allOrders]
  )

  const newPOTotal = newPOLineItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  )

  // ─── Line Item Handlers ────────────────────────────────────────

  const handleAddLineItem = useCallback(() => {
    let product = facilityProducts.find((p) => p.id === selectedProductToAdd)
    let isFromCatalog = false

    if (!product) {
      product = searchResults.find((p) => p.id === selectedProductToAdd)
      isFromCatalog = true
    }

    if (!product) return

    if (newPOLineItems.some((item) => item.sku === product.vendorItemNo)) {
      toast.error("Product already added", { description: "Update the quantity instead" })
      return
    }

    const price = product.contractPrice ?? product.listPrice ?? 0

    setNewPOLineItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.description,
        sku: product.vendorItemNo,
        vendorItemNo: product.vendorItemNo,
        lotSn: "",
        quantity: 1,
        unitPrice: price,
        uom: product.uom,
      },
    ])

    if (isFromCatalog && newPOFacility) {
      toast.info("Product from catalog", {
        description: "This product is not in the facility price file",
      })
    }

    setSelectedProductToAdd("")
    setProductSearch("")
  }, [selectedProductToAdd, facilityProducts, searchResults, newPOLineItems, newPOFacility])

  const handleScanProduct = useCallback(() => {
    if (!scanInput.trim()) return

    const term = scanInput.trim().toUpperCase()
    const allProducts = newPOFacility ? facilityProducts : searchResults

    let product = allProducts.find(
      (p) =>
        p.vendorItemNo.toUpperCase() === term ||
        p.vendorItemNo.toUpperCase().includes(term) ||
        p.description.toUpperCase().includes(term)
    )

    if (!product && newPOFacility) {
      product = searchResults.find(
        (p) =>
          p.vendorItemNo.toUpperCase() === term ||
          p.vendorItemNo.toUpperCase().includes(term) ||
          p.description.toUpperCase().includes(term)
      )
      if (product) {
        toast.info("Product from catalog", {
          description: "This product is not in the facility price file - using list price",
        })
      }
    }

    if (!product) {
      setExceptionProduct({
        sku: scanInput.trim(),
        name: "",
        description: "",
        lotSn: "",
        unitPrice: "",
        reason: "",
      })
      setShowExceptionForm(true)
      toast.info("Product not found", {
        description: "You can add this as a product exception",
      })
      return
    }

    const price = product.contractPrice ?? product.listPrice ?? 0

    const existingIdx = newPOLineItems.findIndex(
      (item) => item.sku === product.vendorItemNo
    )
    if (existingIdx !== -1) {
      const updated = [...newPOLineItems]
      updated[existingIdx].quantity += 1
      setNewPOLineItems(updated)
      toast.success("Quantity updated", {
        description: `${product.description} qty: ${updated[existingIdx].quantity}`,
      })
    } else {
      setNewPOLineItems((prev) => [
        ...prev,
        {
          productId: product.id,
          productName: product.description,
          sku: product.vendorItemNo,
          vendorItemNo: product.vendorItemNo,
          lotSn: "",
          quantity: 1,
          unitPrice: price,
          uom: product.uom,
        },
      ])
      toast.success("Product added", { description: product.description })
    }

    setScanInput("")
  }, [scanInput, facilityProducts, searchResults, newPOLineItems, newPOFacility])

  const handleScanKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault()
      handleScanProduct()
    }
  }

  const handleAddException = () => {
    if (!exceptionProduct.name || !exceptionProduct.unitPrice) {
      toast.error("Missing information", {
        description: "Please enter product name and price",
      })
      return
    }

    const price = parseFloat(exceptionProduct.unitPrice)
    if (isNaN(price) || price <= 0) {
      toast.error("Invalid price", { description: "Please enter a valid price" })
      return
    }

    setNewPOLineItems((prev) => [
      ...prev,
      {
        productId: `exception-${Date.now()}`,
        productName: `${exceptionProduct.name} (Exception)`,
        description: exceptionProduct.description,
        sku: exceptionProduct.sku || `EXC-${Date.now()}`,
        lotSn: exceptionProduct.lotSn,
        quantity: 1,
        unitPrice: price,
        uom: "EA",
        isException: true,
        exceptionReason: exceptionProduct.reason,
      },
    ])

    toast.success("Exception product added", { description: exceptionProduct.name })
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", lotSn: "", unitPrice: "", reason: "" })
    setScanInput("")
  }

  const handleCancelException = () => {
    setShowExceptionForm(false)
    setExceptionProduct({ sku: "", name: "", description: "", lotSn: "", unitPrice: "", reason: "" })
    setScanInput("")
  }

  const handleCameraScan = () => {
    toast.info("Camera scanning", {
      description: "Camera scan would activate here. For demo, use manual entry.",
    })
    setAddMethod("scan")
  }

  const handleUpdateQuantity = (productId: string, quantity: number) => {
    setNewPOLineItems((prev) =>
      prev.map((item) =>
        item.productId === productId ? { ...item, quantity: Math.max(1, quantity) } : item
      )
    )
  }

  const handleUpdateLotSn = (productId: string, lotSn: string) => {
    setNewPOLineItems((prev) =>
      prev.map((item) => (item.productId === productId ? { ...item, lotSn } : item))
    )
  }

  const handleRemoveLineItem = (productId: string) => {
    setNewPOLineItems((prev) => prev.filter((item) => item.productId !== productId))
  }

  // ─── Submit ────────────────────────────────────────────────────

  const handleCreatePO = () => {
    if (!newPOFacility) {
      toast.error("Please select a facility")
      return
    }
    if (!newPODate) {
      toast.error("Please select a PO date")
      return
    }
    if (newPOLineItems.length === 0) {
      toast.error("Please add at least one product")
      return
    }

    createMutation.mutate({
      vendorId,
      facilityId: newPOFacility,
      contractId: selectedFacilityObj?.contractId ?? undefined,
      orderDate: newPODate,
      notes: newPONotes || undefined,
      lineItems: newPOLineItems.map((item) => ({
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

  const resetForm = () => {
    setNewPOFacility("")
    setNewPOType("standard")
    setNewPODate("")
    setNewPONotes("")
    setNewPOLineItems([])
    setScanInput("")
    setProductSearch("")
    setAddMethod("select")
    setShowExceptionForm(false)
    setSelectedProductToAdd("")
    setExceptionProduct({ sku: "", name: "", description: "", lotSn: "", unitPrice: "", reason: "" })
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

  // ─── View PO handler ──────────────────────────────────────────

  const handleViewPO = useCallback((po: VendorPORow) => {
    setSelectedPO(po)
    setIsViewDialogOpen(true)
  }, [])

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <POStatsCards stats={stats} />

      <POFilterBar
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onExportCSV={handleExportCSV}
        onAddPO={() => setIsAddPODialogOpen(true)}
      />

      <POTable
        data={filteredOrders}
        isLoading={isLoading}
        onViewPO={handleViewPO}
      />

      <POViewDialog
        open={isViewDialogOpen}
        onOpenChange={setIsViewDialogOpen}
        selectedPO={selectedPO}
      />

      <POCreateDialog
        open={isAddPODialogOpen}
        onOpenChange={(open) => {
          setIsAddPODialogOpen(open)
          if (!open) resetForm()
        }}
        facility={newPOFacility}
        onFacilityChange={setNewPOFacility}
        poType={newPOType}
        onPOTypeChange={setNewPOType}
        poDate={newPODate}
        onPODateChange={setNewPODate}
        notes={newPONotes}
        onNotesChange={setNewPONotes}
        facilities={facilities}
        selectedFacilityObj={selectedFacilityObj}
        facilityProducts={facilityProducts}
        displayedFacilityProducts={displayedFacilityProducts}
        displayedCatalogProducts={displayedCatalogProducts}
        filteredFacilityProductsCount={filteredFacilityProducts.length}
        filteredCatalogProductsCount={filteredCatalogProducts.length}
        lineItems={newPOLineItems}
        lineItemsTotal={newPOTotal}
        searchTerm={searchTerm}
        selectedProductToAdd={selectedProductToAdd}
        onSelectedProductToAddChange={setSelectedProductToAdd}
        productSearch={productSearch}
        onProductSearchChange={setProductSearch}
        addMethod={addMethod}
        onAddMethodChange={setAddMethod}
        scanInput={scanInput}
        onScanInputChange={setScanInput}
        showExceptionForm={showExceptionForm}
        exceptionProduct={exceptionProduct}
        onExceptionProductChange={setExceptionProduct}
        onAddLineItem={handleAddLineItem}
        onScanProduct={handleScanProduct}
        onScanKeyPress={handleScanKeyPress}
        onAddException={handleAddException}
        onCancelException={handleCancelException}
        onCameraScan={handleCameraScan}
        onUpdateQuantity={handleUpdateQuantity}
        onUpdateLotSn={handleUpdateLotSn}
        onRemoveLineItem={handleRemoveLineItem}
        onCreatePO={handleCreatePO}
        isCreating={createMutation.isPending}
      />
    </div>
  )
}
