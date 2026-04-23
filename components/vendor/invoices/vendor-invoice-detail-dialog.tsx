"use client"

import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  DollarSign,
  Download,
  FileText,
  Package,
  Send,
  TrendingDown,
  TrendingUp,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { statusConfig, type InvoiceRow } from "./vendor-invoice-shared"

export interface VendorInvoiceDetailDialogProps {
  invoice: InvoiceRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VendorInvoiceDetailDialog({
  invoice,
  open,
  onOpenChange,
}: VendorInvoiceDetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        {invoice && (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between">
                <DialogTitle className="text-xl">
                  {invoice.invoiceNumber}
                </DialogTitle>
                <Badge
                  className={
                    statusConfig[invoice.status]?.color ??
                    "bg-muted text-muted-foreground"
                  }
                >
                  {(() => {
                    const cfg = statusConfig[invoice.status]
                    const StatusIcon = cfg?.icon ?? FileText
                    return (
                      <>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {cfg?.label ?? invoice.status}
                      </>
                    )
                  })()}
                </Badge>
              </div>
              <DialogDescription>
                Invoice details and validation status
              </DialogDescription>
            </DialogHeader>

            <Separator />

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Facility
                </p>
                <div className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {invoice.facility?.name ?? "N/A"}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  PO Number
                </p>
                <p className="font-medium text-sm font-mono">
                  {invoice.purchaseOrder?.poNumber ?? "-"}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Invoice Date
                </p>
                <div className="flex items-center gap-1.5">
                  <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="font-medium text-sm">
                    {formatDate(invoice.invoiceDate)}
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Total Amount
                </p>
                <p className="text-xl font-bold text-primary">
                  {formatCurrency(Number(invoice.totalInvoiceCost ?? 0))}
                </p>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <Package className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Line Items
                  </p>
                </div>
                <p className="text-lg font-semibold">{invoice.lineItemCount}</p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  {invoice.variancePercent > 0 ? (
                    <TrendingUp className="h-3.5 w-3.5 text-red-500" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-green-500" />
                  )}
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Variance
                  </p>
                </div>
                <p className="text-lg font-semibold">
                  {formatCurrency(invoice.variance)}{" "}
                  <span
                    className={`text-sm ${invoice.variancePercent > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}
                  >
                    ({invoice.variancePercent > 0 ? "+" : ""}
                    {invoice.variancePercent.toFixed(1)}%)
                  </span>
                </p>
              </div>
              <div className="rounded-lg border p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-500" />
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Flagged Items
                  </p>
                </div>
                <p className="text-lg font-semibold">
                  {invoice.flaggedCount}
                  {invoice.flaggedCount > 0 && (
                    <span className="text-sm text-red-500 ml-1">issues</span>
                  )}
                </p>
              </div>
            </div>

            {invoice.flaggedCount > 0 && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
                <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-semibold">
                    {invoice.flaggedCount} Price Discrepancies Detected
                  </span>
                </div>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                  Some invoice line items do not match contracted pricing.
                  These have been flagged for review.
                </p>
              </div>
            )}

            {invoice.status === "validated" && (
              <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 p-4">
                <div className="flex items-center gap-2 text-green-800 dark:text-green-300">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Invoice Validated</span>
                </div>
                <p className="text-sm text-green-700 dark:text-green-400 mt-1">
                  All line items match contracted pricing. Invoice has been
                  approved for processing.
                </p>
              </div>
            )}

            {invoice.status === "approved" && (
              <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4">
                <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="h-5 w-5" />
                  <span className="font-semibold">Invoice Approved</span>
                </div>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                  This invoice has been approved and is queued for payment
                  processing.
                </p>
              </div>
            )}

            {invoice.status === "paid" && (
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

            {invoice.status === "disputed" && (
              <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 p-4">
                <div className="flex items-center gap-2 text-red-800 dark:text-red-300">
                  <AlertTriangle className="h-5 w-5" />
                  <span className="font-semibold">Invoice Disputed</span>
                </div>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">
                  This invoice is under dispute. Please review the flagged
                  items and contact the facility for resolution.
                </p>
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Download PDF
              </Button>
              {invoice.status === "draft" && (
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
  )
}
