"use client"

import { Check, FileText, Flag } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatDate } from "@/lib/formatting"

import type { InvoiceRow } from "./invoice-discrepancy-table"

export interface InvoiceDetailsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: InvoiceRow | null
  onApprove: (invoiceId: string) => void
  onDispute: (invoice: InvoiceRow) => void
}

export function InvoiceDetailsDialog({
  open,
  onOpenChange,
  invoice,
  onApprove,
  onDispute,
}: InvoiceDetailsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoice {invoice?.invoiceNumber}
          </DialogTitle>
          <DialogDescription>
            {invoice?.vendor.name} -{" "}
            {invoice ? formatDate(invoice.invoiceDate) : ""}
          </DialogDescription>
        </DialogHeader>

        {invoice && (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Total Invoiced</p>
                <p className="text-xl font-bold tabular-nums">
                  {formatCurrency(Number(invoice.totalInvoiceCost ?? 0))}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">Contract Price</p>
                <p className="text-xl font-bold tabular-nums">
                  {formatCurrency(invoice.totalContractCost)}
                </p>
              </div>
              <div className="rounded-lg bg-red-50 p-4 dark:bg-red-950/30">
                <p className="text-sm text-muted-foreground">Variance</p>
                <p className="text-xl font-bold tabular-nums text-red-600 dark:text-red-400">
                  {invoice.variance > 0 ? "+" : ""}
                  {formatCurrency(invoice.variance)}
                </p>
              </div>
            </div>

            <div className="text-sm text-muted-foreground">
              {invoice.lineItemCount} line items | {invoice.flaggedCount} flagged
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {invoice?.status === "pending" && (
            <Button
              variant="outline"
              onClick={() => {
                onApprove(invoice.id)
                onOpenChange(false)
              }}
            >
              <Check className="mr-2 h-4 w-4" />
              Approve
            </Button>
          )}
          {invoice && (
            <Button
              onClick={() => {
                onDispute(invoice)
                onOpenChange(false)
              }}
            >
              <Flag className="mr-2 h-4 w-4" />
              {invoice.disputeStatus === "disputed"
                ? "Resolve Dispute"
                : "Flag as Disputed"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
