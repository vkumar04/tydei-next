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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
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
  Send,
  CalendarDays,
  Hash,
  TrendingUp,
  TrendingDown,
} from "lucide-react"

type InvoiceStatus = "draft" | "submitted" | "pending" | "validated" | "disputed" | "approved" | "paid"

const statusConfig: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  draft: { label: "Draft", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300", icon: Clock },
  submitted: { label: "Submitted", color: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300", icon: FileUp },
  pending: { label: "Pending", color: "bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300", icon: FileText },
  validated: { label: "Validated", color: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300", icon: CheckCircle2 },
  disputed: { label: "Disputed", color: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300", icon: AlertTriangle },
  approved: { label: "Approved", color: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  paid: { label: "Paid", color: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300", icon: DollarSign },
}

const statusTabs: { value: string; label: string; icon: React.ElementType }[] = [
  { value: "all", label: "All", icon: FileText },
  { value: "draft", label: "Draft", icon: Clock },
  { value: "submitted", label: "Submitted", icon: FileUp },
  { value: "validated", label: "Validated", icon: CheckCircle2 },
  { value: "disputed", label: "Disputed", icon: AlertTriangle },
  { value: "approved", label: "Approved", icon: CheckCircle2 },
  { value: "paid", label: "Paid", icon: DollarSign },
]

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
  const [submitDialogOpen, setSubmitDialogOpen] = useState(false)
  const [submitForm, setSubmitForm] = useState({
    invoiceNumber: "",
    facilityName: "",
    amount: "",
    notes: "",
  })

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

  // Filtered count per tab
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: invoices.length }
    for (const inv of invoices) {
      counts[inv.status] = (counts[inv.status] || 0) + 1
    }
    return counts
  }, [invoices])

  function handleSubmitInvoice() {
    // In a real app this would call a server action
    setSubmitDialogOpen(false)
    setSubmitForm({ invoiceNumber: "", facilityName: "", amount: "", notes: "" })
  }

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
          <span className="truncate max-w-[180px]">{row.original.facility?.name ?? "N/A"}</span>
        </div>
      ),
    },
    {
      accessorKey: "totalInvoiceCost",
      header: "Amount",
      cell: ({ row }) => (
        <span className="font-semibold">
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
            <Icon className={`h-3.5 w-3.5 ${isPositive ? "text-red-500" : "text-green-500"}`} />
            <span className={`text-sm font-medium ${isPositive ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
              {isPositive ? "+" : ""}{pct.toFixed(1)}%
            </span>
          </div>
        )
      },
    },
    {
      id: "actions",
      header: "Actions",
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
              <>
                <DropdownMenuItem>
                  <Send className="mr-2 h-4 w-4" />
                  Submit
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive">
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

      {/* Status Filter Tabs + Submit Button */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
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
                    <span className="ml-1 text-xs text-muted-foreground">({count})</span>
                  )}
                </TabsTrigger>
              )
            })}
          </TabsList>
        </Tabs>

        <Button onClick={() => setSubmitDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Submit Invoice
        </Button>
      </div>

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

      {/* View Invoice Detail Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedInvoice && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="text-xl">{selectedInvoice.invoiceNumber}</DialogTitle>
                  <Badge className={statusConfig[selectedInvoice.status]?.color ?? "bg-gray-100 text-gray-700"}>
                    {(() => {
                      const cfg = statusConfig[selectedInvoice.status]
                      const StatusIcon = cfg?.icon ?? FileText
                      return (
                        <>
                          <StatusIcon className="h-3 w-3 mr-1" />
                          {cfg?.label ?? selectedInvoice.status}
                        </>
                      )
                    })()}
                  </Badge>
                </div>
                <DialogDescription>Invoice details and validation status</DialogDescription>
              </DialogHeader>

              <Separator />

              {/* Key metadata grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Facility</p>
                  <div className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="font-medium text-sm">{selectedInvoice.facility?.name ?? "N/A"}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">PO Number</p>
                  <p className="font-medium text-sm font-mono">{selectedInvoice.purchaseOrder?.poNumber ?? "-"}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Invoice Date</p>
                  <div className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="font-medium text-sm">{formatDate(selectedInvoice.invoiceDate)}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Amount</p>
                  <p className="text-xl font-bold text-primary">
                    {formatCurrency(Number(selectedInvoice.totalInvoiceCost ?? 0))}
                  </p>
                </div>
              </div>

              <Separator />

              {/* Secondary metadata */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Line Items</p>
                  </div>
                  <p className="text-lg font-semibold">{selectedInvoice.lineItemCount}</p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5">
                    {selectedInvoice.variancePercent > 0 ? (
                      <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-green-500" />
                    )}
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Variance</p>
                  </div>
                  <p className="text-lg font-semibold">
                    {formatCurrency(selectedInvoice.variance)}{" "}
                    <span className={`text-sm ${selectedInvoice.variancePercent > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
                      ({selectedInvoice.variancePercent > 0 ? "+" : ""}
                      {selectedInvoice.variancePercent.toFixed(1)}%)
                    </span>
                  </p>
                </div>
                <div className="rounded-lg border p-3 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Flagged Items</p>
                  </div>
                  <p className="text-lg font-semibold">
                    {selectedInvoice.flaggedCount}
                    {selectedInvoice.flaggedCount > 0 && (
                      <span className="text-sm text-red-500 ml-1">issues</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Contextual alerts */}
              {selectedInvoice.flaggedCount > 0 && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
                  <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-semibold">
                      {selectedInvoice.flaggedCount} Price Discrepancies Detected
                    </span>
                  </div>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                    Some invoice line items do not match contracted pricing. These have been flagged for review.
                  </p>
                </div>
              )}

              {selectedInvoice.status === "validated" && (
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4">
                  <div className="flex items-center gap-2 text-green-800 dark:text-green-300">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-semibold">Invoice Validated</span>
                  </div>
                  <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                    All line items match contracted pricing. Invoice has been approved for processing.
                  </p>
                </div>
              )}

              {selectedInvoice.status === "approved" && (
                <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                    <CheckCircle2 className="h-5 w-5" />
                    <span className="font-semibold">Invoice Approved</span>
                  </div>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                    This invoice has been approved and is queued for payment processing.
                  </p>
                </div>
              )}

              {selectedInvoice.status === "paid" && (
                <div className="rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/30 p-4">
                  <div className="flex items-center gap-2 text-purple-800 dark:text-purple-300">
                    <DollarSign className="h-5 w-5" />
                    <span className="font-semibold">Payment Complete</span>
                  </div>
                  <p className="text-sm text-purple-700 dark:text-purple-400 mt-1">
                    This invoice has been fully paid.
                  </p>
                </div>
              )}

              {selectedInvoice.status === "disputed" && (
                <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
                  <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
                    <AlertTriangle className="h-5 w-5" />
                    <span className="font-semibold">Invoice Disputed</span>
                  </div>
                  <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                    This invoice is under dispute. Please review the flagged items and contact the facility for resolution.
                  </p>
                </div>
              )}

              <DialogFooter className="gap-2 sm:gap-0">
                <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
                  Close
                </Button>
                <Button variant="outline">
                  <Download className="mr-2 h-4 w-4" />
                  Download PDF
                </Button>
                {selectedInvoice.status === "draft" && (
                  <Button>
                    <Send className="mr-2 h-4 w-4" />
                    Submit Invoice
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Submit Invoice Dialog */}
      <Dialog open={submitDialogOpen} onOpenChange={setSubmitDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Submit New Invoice</DialogTitle>
            <DialogDescription>
              Enter your invoice details below. The invoice will be submitted for validation against contracted pricing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invoice-number">Invoice Number</Label>
              <Input
                id="invoice-number"
                placeholder="e.g. INV-2026-001"
                value={submitForm.invoiceNumber}
                onChange={(e) => setSubmitForm((f) => ({ ...f, invoiceNumber: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="facility-name">Facility</Label>
              <Input
                id="facility-name"
                placeholder="Select or enter facility name"
                value={submitForm.facilityName}
                onChange={(e) => setSubmitForm((f) => ({ ...f, facilityName: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-amount">Total Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="invoice-amount"
                  type="number"
                  placeholder="0.00"
                  className="pl-9"
                  value={submitForm.amount}
                  onChange={(e) => setSubmitForm((f) => ({ ...f, amount: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invoice-notes">Notes (optional)</Label>
              <Input
                id="invoice-notes"
                placeholder="Additional notes or reference numbers"
                value={submitForm.notes}
                onChange={(e) => setSubmitForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div className="rounded-lg bg-muted/50 border p-3">
              <p className="text-xs text-muted-foreground">
                After submission, your invoice will be automatically validated against contracted pricing.
                You will be notified of any discrepancies that require attention.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmitInvoice}
              disabled={!submitForm.invoiceNumber || !submitForm.amount}
            >
              <Send className="mr-2 h-4 w-4" />
              Submit Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
