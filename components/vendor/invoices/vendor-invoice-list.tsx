"use client"

import { useState, useMemo } from "react"
import type { ColumnDef } from "@tanstack/react-table"
import { DataTable } from "@/components/shared/tables/data-table"
import { useInvoices } from "@/hooks/use-invoices"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import {
  FileText,
  Plus,
  Clock,
  CheckCircle2,
  AlertTriangle,
  DollarSign,
  FileUp,
  MoreHorizontal,
  Eye,
  Download,
  Building2,
  Package,
  Trash2,
} from "lucide-react"

type InvoiceStatus = "draft" | "submitted" | "pending" | "validated" | "disputed" | "approved" | "paid"

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700", icon: Clock },
  submitted: { label: "Submitted", color: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300", icon: FileText },
  pending: { label: "Pending", color: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300", icon: FileText },
  validated: { label: "Validated", color: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300", icon: CheckCircle2 },
  disputed: { label: "Disputed", color: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300", icon: AlertTriangle },
  approved: { label: "Approved", color: "bg-emerald-100 text-emerald-700", icon: CheckCircle2 },
  paid: { label: "Paid", color: "bg-purple-100 text-purple-700", icon: DollarSign },
}

type InvoiceRow = {
  id: string
  invoiceNumber: string
  facility: { name: string } | null
  purchaseOrder: { id: string; poNumber: string } | null
  invoiceDate: Date | string
  totalInvoiceCost: number | string | null
  status: string
  lineItemCount: number
  flaggedCount: number
  variance: number
  variancePercent: number
}

interface VendorInvoiceListProps {
  vendorId: string
}

export function VendorInvoiceList({ vendorId }: VendorInvoiceListProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(null)
  const [viewDialogOpen, setViewDialogOpen] = useState(false)

  const { data, isLoading } = useInvoices(vendorId, {
    vendorId,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
  })

  const invoices = (data?.invoices as unknown as InvoiceRow[]) ?? []

  // Summary stats
  const stats = useMemo(() => {
    const all = invoices
    return {
      total: all.length,
      draft: all.filter((i) => i.status === "draft").length,
      submitted: all.filter((i) => i.status === "submitted" || i.status === "pending").length,
      disputed: all.filter((i) => i.status === "disputed").length,
      totalValue: all.reduce((sum, i) => sum + Number(i.totalInvoiceCost ?? 0), 0),
    }
  }, [invoices])

  const columns: ColumnDef<InvoiceRow>[] = [
    {
      accessorKey: "invoiceNumber",
      header: "Invoice #",
      cell: ({ row }) => (
        <span className="font-medium">{row.original.invoiceNumber}</span>
      ),
    },
    {
      accessorKey: "facility.name",
      header: "Facility",
      accessorFn: (row) => row.facility?.name ?? "N/A",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="truncate max-w-[180px]">{row.original.facility?.name ?? "N/A"}</span>
        </div>
      ),
    },
    {
      accessorKey: "purchaseOrder",
      header: "PO #",
      cell: ({ row }) => (
        <span className="font-mono text-sm">
          {row.original.purchaseOrder?.poNumber ?? <span className="text-muted-foreground">-</span>}
        </span>
      ),
    },
    {
      accessorKey: "invoiceDate",
      header: "Date",
      cell: ({ row }) => formatDate(row.original.invoiceDate),
    },
    {
      accessorKey: "lineItemCount",
      header: "Items",
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Package className="h-3 w-3 text-muted-foreground" />
          {row.original.lineItemCount}
          {row.original.flaggedCount > 0 && (
            <Badge variant="destructive" className="ml-1 text-[10px] px-1">
              {row.original.flaggedCount} issues
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "totalInvoiceCost",
      header: "Amount",
      cell: ({ row }) => (
        <span className="font-semibold text-right">
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
              <DropdownMenuItem className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Total Invoices</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-gray-500" />
              <span className="text-sm text-muted-foreground">Drafts</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.draft}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <FileUp className="h-4 w-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">Submitted</span>
            </div>
            <div className="text-2xl font-bold mt-1">{stats.submitted}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm text-muted-foreground">Disputed</span>
            </div>
            <div className="text-2xl font-bold mt-1 text-red-600 dark:text-red-400">{stats.disputed}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-green-500" />
              <span className="text-sm text-muted-foreground">Total Value</span>
            </div>
            <div className="text-2xl font-bold mt-1">{formatCurrency(stats.totalValue)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Status Tabs */}
      <Tabs value={statusFilter} onValueChange={setStatusFilter}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="submitted">Submitted</TabsTrigger>
          <TabsTrigger value="validated">Validated</TabsTrigger>
          <TabsTrigger value="approved">Approved</TabsTrigger>
          <TabsTrigger value="paid">Paid</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Invoices Table */}
      <DataTable
        columns={columns}
        data={invoices}
        searchKey="invoiceNumber"
        searchPlaceholder="Search invoices..."
        isLoading={isLoading}
        onRowClick={(row) => {
          setSelectedInvoice(row)
          setViewDialogOpen(true)
        }}
      />

      {/* View Invoice Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedInvoice && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle>{selectedInvoice.invoiceNumber}</DialogTitle>
                  <Badge className={statusConfig[selectedInvoice.status]?.color ?? "bg-gray-100 text-gray-700"}>
                    {statusConfig[selectedInvoice.status]?.label ?? selectedInvoice.status}
                  </Badge>
                </div>
                <DialogDescription>Invoice details and validation status</DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Facility</p>
                    <p className="font-medium">{selectedInvoice.facility?.name ?? "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">PO Number</p>
                    <p className="font-medium">{selectedInvoice.purchaseOrder?.poNumber ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Date</p>
                    <p className="font-medium">{formatDate(selectedInvoice.invoiceDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    <p className="text-xl font-bold text-primary">
                      {formatCurrency(Number(selectedInvoice.totalInvoiceCost ?? 0))}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Line Items</p>
                    <p className="font-medium">{selectedInvoice.lineItemCount}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Variance</p>
                    <p className="font-medium">
                      {formatCurrency(selectedInvoice.variance)}{" "}
                      <span className={selectedInvoice.variancePercent > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                        ({selectedInvoice.variancePercent > 0 ? "+" : ""}
                        {selectedInvoice.variancePercent.toFixed(1)}%)
                      </span>
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Flagged Items</p>
                    <p className="font-medium">{selectedInvoice.flaggedCount}</p>
                  </div>
                </div>

                {selectedInvoice.flaggedCount > 0 && (
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <div className="flex items-center gap-2 text-red-800">
                      <AlertTriangle className="h-5 w-5" />
                      <span className="font-semibold">
                        {selectedInvoice.flaggedCount} Price Discrepancies Detected
                      </span>
                    </div>
                    <p className="text-sm text-red-700 mt-1">
                      Some invoice line items do not match contracted pricing. These have been flagged for review.
                    </p>
                  </div>
                )}

                {selectedInvoice.status === "validated" && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                    <div className="flex items-center gap-2 text-green-800">
                      <CheckCircle2 className="h-5 w-5" />
                      <span className="font-semibold">Invoice Validated</span>
                    </div>
                    <p className="text-sm text-green-700 mt-1">
                      All line items match contracted pricing. Invoice has been approved for processing.
                    </p>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Close
                </Button>
                <Button variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
