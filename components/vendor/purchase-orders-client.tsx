"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { ColumnDef } from "@tanstack/react-table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { DataTable } from "@/components/shared/tables/data-table"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { getVendorPurchaseOrders, type VendorPORow } from "@/lib/actions/vendor-purchase-orders"
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
} from "lucide-react"
import { toast } from "sonner"

type POStatus = string

const poStatusConfig: Record<string, { label: string; color: string; description: string }> = {
  pending_approval: { label: "Pending Approval", color: "bg-orange-100 text-orange-800", description: "Awaiting facility review" },
  pending: { label: "Pending", color: "bg-orange-100 text-orange-800", description: "Awaiting facility review" },
  approved: { label: "Approved", color: "bg-green-100 text-green-800", description: "Facility approved - ready to process" },
  rejected: { label: "Rejected", color: "bg-red-100 text-red-800", description: "Facility declined this order" },
  sent: { label: "Sent", color: "bg-blue-100 text-blue-800", description: "Order sent to facility" },
  acknowledged: { label: "Acknowledged", color: "bg-cyan-100 text-cyan-800", description: "Facility confirmed receipt" },
  processing: { label: "Processing", color: "bg-yellow-100 text-yellow-800", description: "Order being prepared" },
  shipped: { label: "Shipped", color: "bg-purple-100 text-purple-800", description: "Order in transit" },
  fulfilled: { label: "Fulfilled", color: "bg-green-200 text-green-900", description: "Order completed" },
  cancelled: { label: "Cancelled", color: "bg-red-100 text-red-800", description: "Order cancelled" },
}

interface VendorPurchaseOrdersClientProps {
  vendorId: string
}

export function VendorPurchaseOrdersClient({ vendorId }: VendorPurchaseOrdersClientProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedPO, setSelectedPO] = useState<VendorPORow | null>(null)
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["vendorPOs", vendorId],
    queryFn: () => getVendorPurchaseOrders(vendorId),
  })

  const allOrders = data ?? []

  // Filter by status tab
  const filteredOrders = useMemo(() => {
    if (statusFilter === "all") return allOrders
    return allOrders.filter((po) => po.status === statusFilter)
  }, [allOrders, statusFilter])

  // Summary stats
  const stats = useMemo(() => ({
    pendingApproval: allOrders.filter((po) => po.status === "pending_approval" || po.status === "pending").length,
    approved: allOrders.filter((po) => po.status === "approved").length,
    inProgress: allOrders.filter((po) => ["acknowledged", "processing", "sent", "shipped"].includes(po.status)).length,
    fulfilled: allOrders.filter((po) => po.status === "fulfilled").length,
    rejected: allOrders.filter((po) => po.status === "rejected" || po.status === "cancelled").length,
    totalValue: allOrders.reduce((sum, po) => sum + po.totalCost, 0),
  }), [allOrders])

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

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card className={stats.pendingApproval > 0 ? "border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
            <Clock className={`h-4 w-4 ${stats.pendingApproval > 0 ? "text-orange-600" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.pendingApproval > 0 ? "text-orange-600" : ""}`}>
              {stats.pendingApproval}
            </div>
            <p className="text-xs text-muted-foreground">Awaiting facility approval</p>
          </CardContent>
        </Card>
        <Card className={stats.approved > 0 ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
            <CheckCircle2 className={`h-4 w-4 ${stats.approved > 0 ? "text-green-600" : "text-muted-foreground"}`} />
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
        <Card className={stats.rejected > 0 ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20" : ""}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
            <XCircle className={`h-4 w-4 ${stats.rejected > 0 ? "text-red-600" : "text-muted-foreground"}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.rejected > 0 ? "text-red-600" : ""}`}>
              {stats.rejected}
            </div>
            <p className="text-xs text-muted-foreground">Declined by facility</p>
          </CardContent>
        </Card>
      </div>

      {/* Status Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="pending">Pending</TabsTrigger>
            <TabsTrigger value="approved">Approved</TabsTrigger>
            <TabsTrigger value="shipped">Shipped</TabsTrigger>
            <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          </TabsList>
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

      {/* View PO Dialog */}
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
                  <Badge className={poStatusConfig[selectedPO.status]?.color ?? "bg-gray-100 text-gray-700"}>
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
    </div>
  )
}
