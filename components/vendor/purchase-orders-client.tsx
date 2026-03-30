"use client"

import { useState, useMemo, useCallback } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import {
  getVendorPurchaseOrders,
  getVendorFacilities,
  getVendorFacilityProducts,
  searchVendorProducts,
  createVendorPurchaseOrder,
  type VendorPORow,
  type VendorFacilityRow,
  type VendorProductRow,
} from "@/lib/actions/vendor-purchase-orders"
import {
  MoreHorizontal,
  Eye,
  Download,
  Clock,
  CheckCircle2,
  XCircle,
  Package,
  Building2,
  FileText,
  FileSpreadsheet,
  Plus,
  Trash2,
  ScanLine,
  Camera,
  Search,
  AlertCircle,
} from "lucide-react"
import { toast } from "sonner"

// ─── PO Type Config ────────────────────────────────────────────────

type POType = "standard" | "blanket" | "planned" | "contract" | "emergency"

const poTypeLabels: Record<POType, string> = {
  standard: "Standard",
  blanket: "Blanket",
  planned: "Planned",
  contract: "Contract",
  emergency: "Emergency",
}

const poTypeDescriptions: Record<POType, string> = {
  standard: "One-time purchase order for immediate needs",
  blanket: "Ongoing order with set terms over a period",
  planned: "Scheduled future order with confirmed delivery",
  contract: "Order tied to an existing contract agreement",
  emergency: "Urgent order requiring expedited processing",
}

// ─── PO Status Config ──────────────────────────────────────────────

const poStatusConfig: Record<string, { label: string; color: string; description: string }> = {
  pending_approval: { label: "Pending Approval", color: "bg-orange-100 text-orange-800", description: "Awaiting facility review" },
  pending: { label: "Pending", color: "bg-orange-100 text-orange-800", description: "Awaiting facility review" },
  draft: { label: "Draft", color: "bg-gray-100 text-gray-800", description: "Draft order" },
  approved: { label: "Approved", color: "bg-green-100 text-green-800", description: "Facility approved - ready to process" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800", description: "Facility declined this order" },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-800", description: "Order sent to facility" },
  acknowledged: { label: "Acknowledged", color: "bg-cyan-100 text-cyan-800", description: "Facility confirmed receipt" },
  processing: { label: "Processing", color: "bg-yellow-100 text-yellow-800", description: "Order being prepared" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-800", description: "Order in transit" },
  fulfilled: { label: "Fulfilled", color: "bg-green-200 text-green-900", description: "Order completed" },
  completed: { label: "Completed", color: "bg-green-200 text-green-900", description: "Order completed" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800", description: "Order cancelled" },
}

// ─── Line Item Type ────────────────────────────────────────────────

interface POLineItem {
  productId: string
  productName: string
  description?: string
  sku: string
  vendorItemNo?: string
  lotSn?: string
  quantity: number
  unitPrice: number
  uom: string
  isException?: boolean
  exceptionReason?: string
}

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

  // Load all products for the selected facility
  const { data: facilityProducts = [] } = useQuery({
    queryKey: ["vendorFacilityProducts", vendorId, newPOFacility],
    queryFn: () => getVendorFacilityProducts({ vendorId, facilityId: newPOFacility }),
    enabled: !!newPOFacility,
  })

  // Search products across all facilities (when searching without facility or for catalog items)
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

  // Filter facility products by search term
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

  // Catalog results: search results not already in facility products
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

  // ─── Data ──────────────────────────────────────────────────────

  const allOrders = data ?? []

  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return allOrders
    return allOrders.filter((po) => po.status === statusFilter)
  }, [allOrders, statusFilter])

  const stats = useMemo(
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

  // ─── Line Item Handlers ────────────────────────────────────────

  const handleAddLineItem = useCallback(() => {
    // Search facility products first, then catalog
    let product: VendorProductRow | undefined = facilityProducts.find(
      (p) => p.id === selectedProductToAdd
    )
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

  const newPOTotal = newPOLineItems.reduce(
    (sum, item) => sum + item.unitPrice * item.quantity,
    0
  )

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

  // ─── Table Columns ─────────────────────────────────────────────

  const columns: ColumnDef<VendorPORow>[] = [
    {
      accessorKey: "poNumber",
      header: "PO #",
      cell: ({ row }) => <span className="font-medium">{row.original.poNumber}</span>,
    },
    {
      accessorKey: "facilityName",
      header: "Facility",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {row.original.facilityName}
        </div>
      ),
    },
    {
      accessorKey: "orderDate",
      header: "Order Date",
      cell: ({ row }) => formatDate(row.original.orderDate),
    },
    {
      accessorKey: "totalCost",
      header: "Total",
      cell: ({ row }) => (
        <span className="font-semibold">{formatCurrency(row.original.totalCost)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const s = row.original.status
        const config = poStatusConfig[s] ?? { label: s, color: "bg-gray-100 text-gray-700" }
        return <Badge className={config.color}>{config.label}</Badge>
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.stopPropagation()
                setSelectedPO(row.original)
                setIsViewDialogOpen(true)
              }}
            >
              <Eye className="mr-2 h-4 w-4" />
              View Details
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  // ─── Render ────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card
          className={
            stats.pendingApproval > 0
              ? "border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20"
              : ""
          }
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
            <Clock
              className={`h-4 w-4 ${stats.pendingApproval > 0 ? "text-orange-600" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${stats.pendingApproval > 0 ? "text-orange-600" : ""}`}
            >
              {stats.pendingApproval}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting facility approval</p>
          </CardContent>
        </Card>
        <Card
          className={
            stats.approved > 0
              ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
              : ""
          }
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle2
              className={`h-4 w-4 ${stats.approved > 0 ? "text-green-600" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.approved > 0 ? "text-green-600" : ""}`}>
              {stats.approved}
            </div>
            <p className="text-xs text-muted-foreground">Ready to process</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">In Progress</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.inProgress}</div>
            <p className="text-xs text-muted-foreground">Processing & shipping</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fulfilled</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.fulfilled}</div>
            <p className="text-xs text-muted-foreground">Completed orders</p>
          </CardContent>
        </Card>
        <Card
          className={
            stats.rejected > 0
              ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
              : ""
          }
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
            <XCircle
              className={`h-4 w-4 ${stats.rejected > 0 ? "text-red-600" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.rejected > 0 ? "text-red-600" : ""}`}>
              {stats.rejected}
            </div>
            <p className="text-xs text-muted-foreground">Declined by facility</p>
          </CardContent>
        </Card>
      </div>

      {/* Status Tabs + Actions */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="shipped">Shipped</TabsTrigger>
            <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          </TabsList>
          <div className="flex gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Download className="h-4 w-4" />
                  Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportCSV}>
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export as CSV
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => setIsAddPODialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Add PO
            </Button>
          </div>
        </div>
      </Tabs>

      {/* PO Table */}
      <DataTable
        columns={columns}
        data={filteredOrders}
        searchKey="poNumber"
        searchPlaceholder="Search orders..."
        isLoading={isLoading}
        onRowClick={(row) => {
          setSelectedPO(row)
          setIsViewDialogOpen(true)
        }}
      />

      {/* ────────────────── View PO Dialog ────────────────── */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Purchase Order Details</DialogTitle>
            <DialogDescription>
              {selectedPO?.poNumber} - {selectedPO?.facilityName}
            </DialogDescription>
          </DialogHeader>
          {selectedPO && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    className={
                      poStatusConfig[selectedPO.status]?.color ?? "bg-gray-100 text-gray-700"
                    }
                  >
                    {poStatusConfig[selectedPO.status]?.label ?? selectedPO.status}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="text-lg font-bold">{formatCurrency(selectedPO.totalCost)}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Facility</p>
                  <p className="font-medium">{selectedPO.facilityName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Order Date</p>
                  <p className="font-medium">{formatDate(selectedPO.orderDate)}</p>
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsViewDialogOpen(false)}>
              Close
            </Button>
            {selectedPO?.status === "sent" && (
              <Button>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Acknowledge Order
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ────────────────── Add PO Dialog ────────────────── */}
      <Dialog
        open={isAddPODialogOpen}
        onOpenChange={(open) => {
          setIsAddPODialogOpen(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="max-w-5xl w-[95vw] max-h-[95vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Purchase Order</DialogTitle>
            <DialogDescription>
              Create a new purchase order on behalf of a facility
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Facility and PO Type Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="facility">Facility *</Label>
                <Select value={newPOFacility} onValueChange={setNewPOFacility}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select facility" />
                  </SelectTrigger>
                  <SelectContent>
                    {facilities.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4" />
                          {f.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="poType">PO Type *</Label>
                <Select
                  value={newPOType}
                  onValueChange={(v) => setNewPOType(v as POType)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select PO type" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(poTypeLabels) as POType[]).map((type) => (
                      <SelectItem key={type} value={type}>
                        <div className="flex flex-col">
                          <span>{poTypeLabels[type]}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {poTypeDescriptions[newPOType]}
                </p>
              </div>
            </div>

            {/* PO Date */}
            <div className="space-y-2">
              <Label htmlFor="poDate">PO Date *</Label>
              <Input
                id="poDate"
                type="date"
                value={newPODate}
                onChange={(e) => setNewPODate(e.target.value)}
                className="w-full max-w-xs"
              />
            </div>

            {/* Add Products - Method Selection */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Add Products</Label>
                  {newPOFacility && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Showing {facilityProducts.length} products from{" "}
                      {selectedFacilityObj?.name} price file
                      {selectedFacilityObj?.contractId && (
                        <span className="text-green-600 ml-1">(Contract pricing)</span>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex gap-1 bg-muted p-1 rounded-lg">
                  <Button
                    variant={addMethod === "select" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setAddMethod("select")}
                    className="h-7 px-3"
                  >
                    <Package className="h-3 w-3 mr-1" />
                    Select
                  </Button>
                  <Button
                    variant={addMethod === "scan" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setAddMethod("scan")}
                    className="h-7 px-3"
                  >
                    <ScanLine className="h-3 w-3 mr-1" />
                    Scan
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCameraScan}
                    className="h-7 px-3"
                  >
                    <Camera className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {addMethod === "select" && (
                <div className="space-y-2">
                  {/* Search input */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search products by name, SKU, or category..."
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>

                  {/* Product list */}
                  <div className="border rounded-lg max-h-[350px] overflow-y-auto">
                    {!searchTerm && !newPOFacility ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>Search for products by name, SKU, or category</p>
                        <p className="text-xs mt-1">
                          Or select a facility to see their price file
                        </p>
                      </div>
                    ) : searchTerm && searchTerm.length < 2 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        Type at least 2 characters to search...
                      </div>
                    ) : displayedFacilityProducts.length === 0 &&
                      displayedCatalogProducts.length === 0 ? (
                      <div className="p-4 text-center text-muted-foreground">
                        <p>No products match &quot;{productSearch}&quot;</p>
                        <p className="text-xs mt-1">
                          Try a different search term or add as exception
                        </p>
                      </div>
                    ) : (
                      <div>
                        {/* Facility Price File Products */}
                        {displayedFacilityProducts.length > 0 && (
                          <>
                            {newPOFacility && (
                              <div className="px-3 py-2 bg-green-50 dark:bg-green-950/30 text-xs font-medium text-green-700 dark:text-green-300 border-b flex items-center justify-between">
                                <span>
                                  Price File Products ({filteredFacilityProducts.length})
                                </span>
                                {selectedFacilityObj?.contractId && (
                                  <span>Contract Pricing</span>
                                )}
                              </div>
                            )}
                            <div className="divide-y">
                              {displayedFacilityProducts.map((p) => {
                                const hasContractPrice = p.contractPrice != null
                                const displayPrice = hasContractPrice
                                  ? p.contractPrice!
                                  : p.listPrice ?? 0
                                const isSelected = selectedProductToAdd === p.id
                                return (
                                  <div
                                    key={p.id}
                                    className={`p-3 cursor-pointer hover:bg-muted/50 flex items-start justify-between gap-3 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                                    onClick={() =>
                                      setSelectedProductToAdd(isSelected ? "" : p.id)
                                    }
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium">{p.description}</div>
                                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                                        <span className="font-mono">{p.vendorItemNo}</span>
                                        {p.category && (
                                          <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                                            {p.category}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="font-medium">
                                        {formatCurrency(displayPrice)}
                                      </div>
                                      {hasContractPrice && (
                                        <div className="text-xs text-green-600">
                                          Contract price
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </>
                        )}

                        {/* Full Catalog Products (not in price file) */}
                        {displayedCatalogProducts.length > 0 && (
                          <>
                            <div className="px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground border-y flex items-center justify-between">
                              <span>
                                Full Catalog ({filteredCatalogProducts.length} more)
                              </span>
                              <span>List Price</span>
                            </div>
                            <div className="divide-y">
                              {displayedCatalogProducts.map((p) => {
                                const isSelected = selectedProductToAdd === p.id
                                return (
                                  <div
                                    key={p.id}
                                    className={`p-3 cursor-pointer hover:bg-muted/50 flex items-start justify-between gap-3 ${isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""}`}
                                    onClick={() =>
                                      setSelectedProductToAdd(isSelected ? "" : p.id)
                                    }
                                  >
                                    <div className="flex-1 min-w-0">
                                      <div className="font-medium">{p.description}</div>
                                      <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                                        <span className="font-mono">{p.vendorItemNo}</span>
                                        {p.category && (
                                          <span className="px-1.5 py-0.5 bg-muted rounded text-[10px]">
                                            {p.category}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="text-right shrink-0">
                                      <div className="font-medium">
                                        {formatCurrency(p.listPrice ?? 0)}
                                      </div>
                                      <div className="text-xs text-muted-foreground">
                                        List price
                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                          </>
                        )}

                        {/* Show count if more results */}
                        {(filteredFacilityProducts.length > 50 ||
                          filteredCatalogProducts.length >
                            50 - displayedFacilityProducts.length) && (
                          <div className="px-3 py-2 text-xs text-center text-muted-foreground bg-muted/30">
                            Showing first 50 results. Refine your search for more specific
                            results.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <Button
                    onClick={handleAddLineItem}
                    disabled={!selectedProductToAdd}
                    className="w-full"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add Selected Product
                  </Button>
                </div>
              )}

              {addMethod === "scan" && !showExceptionForm && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Scan barcode or enter SKU..."
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        onKeyDown={handleScanKeyPress}
                        className="pl-10"
                        autoFocus
                      />
                    </div>
                    <Button onClick={handleScanProduct} disabled={!scanInput.trim()}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Scan a barcode or manually enter a SKU/product code and press Enter
                  </p>
                </div>
              )}

              {/* Product Exception Form */}
              {showExceptionForm && (
                <div className="border border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20 rounded-lg p-4 space-y-4">
                  <div className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
                    <AlertCircle className="h-4 w-4" />
                    <span className="font-medium">Product Exception</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    No product found matching &quot;{exceptionProduct.sku}&quot;. Enter details
                    to add as an exception.
                  </p>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="exc-sku">SKU / Code</Label>
                      <Input
                        id="exc-sku"
                        value={exceptionProduct.sku}
                        onChange={(e) =>
                          setExceptionProduct({ ...exceptionProduct, sku: e.target.value })
                        }
                        placeholder="Enter SKU"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="exc-price">Unit Price *</Label>
                      <Input
                        id="exc-price"
                        type="number"
                        step="0.01"
                        min="0"
                        value={exceptionProduct.unitPrice}
                        onChange={(e) =>
                          setExceptionProduct({
                            ...exceptionProduct,
                            unitPrice: e.target.value,
                          })
                        }
                        placeholder="0.00"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exc-name">Product Name *</Label>
                    <Input
                      id="exc-name"
                      value={exceptionProduct.name}
                      onChange={(e) =>
                        setExceptionProduct({ ...exceptionProduct, name: e.target.value })
                      }
                      placeholder="Enter product name"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exc-desc">Description</Label>
                    <Input
                      id="exc-desc"
                      value={exceptionProduct.description}
                      onChange={(e) =>
                        setExceptionProduct({
                          ...exceptionProduct,
                          description: e.target.value,
                        })
                      }
                      placeholder="Enter product description"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exc-lotsn">LOT/SN</Label>
                    <Input
                      id="exc-lotsn"
                      value={exceptionProduct.lotSn}
                      onChange={(e) =>
                        setExceptionProduct({ ...exceptionProduct, lotSn: e.target.value })
                      }
                      placeholder="Lot code or serial number"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="exc-reason">Reason for Exception</Label>
                    <Textarea
                      id="exc-reason"
                      value={exceptionProduct.reason}
                      onChange={(e) =>
                        setExceptionProduct({ ...exceptionProduct, reason: e.target.value })
                      }
                      placeholder="Why is this product not in the price file? (e.g., new item, special request, trial product)"
                      rows={2}
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      onClick={handleCancelException}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleAddException}
                      disabled={!exceptionProduct.name || !exceptionProduct.unitPrice}
                      className="flex-1 bg-orange-600 hover:bg-orange-700"
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Exception
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* Line Items Table */}
            {newPOLineItems.length > 0 && (
              <div className="border rounded-lg">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="w-[140px]">LOT/SN</TableHead>
                      <TableHead className="w-[80px]">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {newPOLineItems.map((item) => (
                      <TableRow
                        key={item.productId}
                        className={
                          item.isException
                            ? "bg-orange-50/50 dark:bg-orange-950/20"
                            : ""
                        }
                      >
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{item.productName}</div>
                            {item.isException && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 bg-orange-100 text-orange-800 border-orange-300"
                              >
                                Exception
                              </Badge>
                            )}
                          </div>
                          {item.description && (
                            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                              {item.description}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {item.sku}
                        </TableCell>
                        <TableCell>
                          <Input
                            placeholder="LOT/SN"
                            value={item.lotSn || ""}
                            onChange={(e) =>
                              handleUpdateLotSn(item.productId, e.target.value)
                            }
                            className="w-[130px] h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) =>
                              handleUpdateQuantity(
                                item.productId,
                                parseInt(e.target.value) || 1
                              )
                            }
                            className="w-[70px] h-8"
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(item.unitPrice)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(item.unitPrice * item.quantity)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => handleRemoveLineItem(item.productId)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-muted/50">
                      <TableCell colSpan={5} className="text-right font-medium">
                        Order Total:
                      </TableCell>
                      <TableCell className="text-right font-bold text-lg">
                        {formatCurrency(newPOTotal)}
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {newPOLineItems.length === 0 && (
              <div className="border rounded-lg p-8 text-center text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p>No products added yet</p>
                <p className="text-sm">
                  {addMethod === "scan"
                    ? "Scan a barcode or enter a SKU to add products"
                    : "Select a product from the dropdown or scan to add"}
                </p>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                placeholder="Add any special instructions or notes for this order..."
                value={newPONotes}
                onChange={(e) => setNewPONotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddPODialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreatePO}
              disabled={
                !newPOFacility ||
                !newPODate ||
                newPOLineItems.length === 0 ||
                createMutation.isPending
              }
            >
              <FileText className="mr-2 h-4 w-4" />
              {createMutation.isPending ? "Creating..." : "Create Purchase Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
