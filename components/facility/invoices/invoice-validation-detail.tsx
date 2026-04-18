"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { DisputeDialog } from "./dispute-dialog"
import { InvoiceDisputeDialog } from "./invoice-dispute-dialog"
import { useFlagInvoiceLineItem, useResolveInvoiceLineItem } from "@/hooks/use-invoices"
import { AlertTriangle, Check, Flag } from "lucide-react"

// ─── Types ──────────────────────────────────────────────────────

type ValidationLineItem = {
  lineItemId: string
  inventoryDescription: string
  vendorItemNo: string | null
  invoicePrice: number
  invoiceQuantity: number
  totalLineCost: number
  contractPrice: number | null
  variancePercent: number | null
  isFlagged: boolean
  hasDiscrepancy: boolean
}

type DisputeStatus = "none" | "disputed" | "resolved" | "rejected"

interface InvoiceValidationDetailProps {
  invoiceId: string
  validation: {
    lineItems: ValidationLineItem[]
    discrepancyCount: number
    averageVariance: number
  }
  invoice?: {
    id: string
    invoiceNumber: string
    vendorName: string
    disputeStatus: DisputeStatus
    disputeNote: string | null
    totalInvoiceCost: number
  }
}

// ─── Helpers ────────────────────────────────────────────────────

function severityFor(
  variancePercent: number | null
): "none" | "minor" | "moderate" | "major" {
  if (variancePercent === null) return "none"
  const abs = Math.abs(variancePercent)
  if (abs < 2) return "minor"
  if (abs < 10) return "moderate"
  return "major"
}

function SeverityBadge({
  severity,
}: {
  severity: "none" | "minor" | "moderate" | "major"
}) {
  if (severity === "none") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        N/A
      </Badge>
    )
  }
  if (severity === "minor") {
    return (
      <Badge className="border-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
        Minor
      </Badge>
    )
  }
  if (severity === "moderate") {
    return (
      <Badge className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
        Moderate
      </Badge>
    )
  }
  return (
    <Badge className="border-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
      Major
    </Badge>
  )
}

function DisputeStatusBadge({ status }: { status: DisputeStatus }) {
  if (status === "disputed") {
    return (
      <Badge className="border-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
        Disputed
      </Badge>
    )
  }
  if (status === "resolved") {
    return (
      <Badge className="border-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
        Resolved
      </Badge>
    )
  }
  if (status === "rejected") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        Rejected
      </Badge>
    )
  }
  return null
}

// ─── Component ──────────────────────────────────────────────────

export function InvoiceValidationDetail({
  invoiceId: _invoiceId,
  validation,
  invoice,
}: InvoiceValidationDetailProps) {
  const [disputeItem, setDisputeItem] = useState<ValidationLineItem | null>(
    null
  )
  const [invoiceDisputeOpen, setInvoiceDisputeOpen] = useState(false)
  const flagItem = useFlagInvoiceLineItem()
  const resolveItem = useResolveInvoiceLineItem()

  // Invoice-level variance totals — re-derive here for the header
  // summary since the detail page doesn't pre-compute them.
  const totals = useMemo(() => {
    let invoiceTotal = 0
    let contractTotal = 0
    let overchargeLines = 0
    for (const li of validation.lineItems) {
      invoiceTotal += li.invoicePrice * li.invoiceQuantity
      if (li.contractPrice !== null) {
        contractTotal += li.contractPrice * li.invoiceQuantity
      } else {
        contractTotal += li.invoicePrice * li.invoiceQuantity
      }
      if ((li.variancePercent ?? 0) > 0) overchargeLines += 1
    }
    return {
      invoiceTotal,
      contractTotal,
      variance: invoiceTotal - contractTotal,
      overchargeLines,
    }
  }, [validation.lineItems])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <Badge variant={validation.discrepancyCount > 0 ? "destructive" : "default"}>
          {validation.discrepancyCount} discrepancies
        </Badge>
        {validation.averageVariance > 0 && (
          <span className="text-sm text-muted-foreground">
            Avg variance: {formatPercent(validation.averageVariance)}
          </span>
        )}
        {invoice && invoice.disputeStatus !== "none" && (
          <DisputeStatusBadge status={invoice.disputeStatus} />
        )}
        {invoice && (
          <Button
            variant={invoice.disputeStatus === "disputed" ? "outline" : "destructive"}
            size="sm"
            className="ml-auto"
            onClick={() => setInvoiceDisputeOpen(true)}
          >
            <Flag className="mr-2 h-4 w-4" />
            {invoice.disputeStatus === "disputed"
              ? "Resolve Dispute"
              : "Flag as Disputed"}
          </Button>
        )}
      </div>

      {invoice && invoice.disputeStatus === "disputed" && invoice.disputeNote && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/30">
          <CardContent className="p-4 space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-red-700 dark:text-red-300">
              Dispute note
            </p>
            <p className="text-sm whitespace-pre-wrap">{invoice.disputeNote}</p>
          </CardContent>
        </Card>
      )}

      {/* Invoice variance summary */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Invoiced</p>
            <p className="text-xl font-bold tracking-tight">
              {formatCurrency(totals.invoiceTotal, true)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Contract total</p>
            <p className="text-xl font-bold tracking-tight">
              {formatCurrency(totals.contractTotal, true)}
            </p>
          </CardContent>
        </Card>
        <Card
          className={
            totals.variance > 0.01
              ? "border-red-200 dark:border-red-900"
              : undefined
          }
        >
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">
              Total {totals.variance >= 0 ? "overcharge" : "undercharge"}
            </p>
            <p
              className={
                totals.variance > 0.01
                  ? "text-xl font-bold text-red-600 dark:text-red-400"
                  : totals.variance < -0.01
                    ? "text-xl font-bold text-green-600 dark:text-green-400"
                    : "text-xl font-bold"
              }
            >
              {totals.variance > 0 ? "+" : ""}
              {formatCurrency(totals.variance, true)}
            </p>
            <p className="text-xs text-muted-foreground">
              {totals.overchargeLines} line
              {totals.overchargeLines === 1 ? "" : "s"} over contract
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Item Validation</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Item #</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Invoice Price</TableHead>
                <TableHead>Contract Price</TableHead>
                <TableHead>Variance %</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {validation.lineItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No line items on this invoice.
                  </TableCell>
                </TableRow>
              ) : (
                validation.lineItems.map((li) => {
                  const severity = severityFor(li.variancePercent)
                  return (
                    <TableRow
                      key={li.lineItemId}
                      className={li.hasDiscrepancy ? "bg-destructive/5" : ""}
                    >
                      <TableCell className="max-w-[240px]">
                        <span className="block truncate">
                          {li.inventoryDescription}
                        </span>
                      </TableCell>
                      <TableCell>{li.vendorItemNo ?? "-"}</TableCell>
                      <TableCell>{li.invoiceQuantity}</TableCell>
                      <TableCell>
                        {formatCurrency(li.invoicePrice, true)}
                      </TableCell>
                      <TableCell>
                        {li.contractPrice !== null ? (
                          formatCurrency(li.contractPrice, true)
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {li.variancePercent !== null ? (
                          <span
                            className={
                              Math.abs(li.variancePercent) > 5
                                ? "font-medium text-destructive"
                                : ""
                            }
                          >
                            {li.variancePercent > 0 ? "+" : ""}
                            {formatPercent(li.variancePercent)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <SeverityBadge severity={severity} />
                      </TableCell>
                      <TableCell>
                        {li.isFlagged ? (
                          <Badge variant="destructive">Flagged</Badge>
                        ) : li.hasDiscrepancy ? (
                          <AlertTriangle className="size-4 text-amber-500" />
                        ) : (
                          <Check className="size-4 text-emerald-500" />
                        )}
                      </TableCell>
                      <TableCell>
                        {li.isFlagged ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => resolveItem.mutate(li.lineItemId)}
                          >
                            Resolve
                          </Button>
                        ) : li.hasDiscrepancy ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDisputeItem(li)}
                          >
                            Flag
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {disputeItem && (
        <DisputeDialog
          open={!!disputeItem}
          onOpenChange={(open) => {
            if (!open) setDisputeItem(null)
          }}
          itemDescription={disputeItem.inventoryDescription}
          onSubmit={(notes) => {
            flagItem.mutate({ lineItemId: disputeItem.lineItemId, notes })
            setDisputeItem(null)
          }}
        />
      )}

      {invoice && (
        <InvoiceDisputeDialog
          open={invoiceDisputeOpen}
          onOpenChange={setInvoiceDisputeOpen}
          invoiceId={invoice.id}
          invoiceNumber={invoice.invoiceNumber}
          vendorName={invoice.vendorName}
          currentStatus={invoice.disputeStatus}
          existingNote={invoice.disputeNote}
        />
      )}
    </div>
  )
}
