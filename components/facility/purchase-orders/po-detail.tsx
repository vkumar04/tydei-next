"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import type { PurchaseOrder, POLineItem, Vendor, Contract } from "@/lib/generated/prisma/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { poStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { useUpdatePOStatus } from "@/hooks/use-purchase-orders"
// H4 (2026-06-09 audit): transitions come from the canonical shared map —
// the same one updatePOStatus validates against server-side.
import { PO_STATUS_FLOW } from "@/lib/purchase-orders/status-flow"

// ─── Types ──────────────────────────────────────────────────────

type PODetail = PurchaseOrder & {
  vendor: Pick<Vendor, "id" | "name">
  contract: Pick<Contract, "id" | "name"> | null
  lineItems: POLineItem[]
}

// ─── Sub-components ─────────────────────────────────────────────

/** Mask a patient MRN to its last 4 characters, e.g. `•••1234`. */
function maskMrn(mrn: string): string {
  return `•••${mrn.slice(-4)}`
}

function OnContractBadge({ isOffContract }: { isOffContract: boolean }) {
  if (isOffContract) {
    return (
      <Badge className="border-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
        Off-contract
      </Badge>
    )
  }
  return (
    <Badge className="border-0 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
      On-contract
    </Badge>
  )
}

interface PODetailViewProps {
  order: PODetail
}

// ─── Component ──────────────────────────────────────────────────

export function PODetailView({ order }: PODetailViewProps) {
  const router = useRouter()
  const updateStatus = useUpdatePOStatus()
  const nextStatuses = PO_STATUS_FLOW[order.status] ?? []

  // Lot/serial columns only render when at least one line carries a value
  // (legacy POs predate the columns; keep their table compact).
  const hasLotSerial = useMemo(
    () => order.lineItems.some((li) => li.lotNumber || li.serialNumber),
    [order.lineItems],
  )

  const summary = useMemo(() => {
    let offCount = 0
    let offSpend = 0
    let onCount = 0
    let onSpend = 0
    for (const li of order.lineItems) {
      const extended = Number(li.extendedPrice)
      if (li.isOffContract) {
        offCount += 1
        offSpend += extended
      } else {
        onCount += 1
        onSpend += extended
      }
    }
    const total = onSpend + offSpend
    const offPercent = total > 0 ? (offSpend / total) * 100 : 0
    return { offCount, offSpend, onCount, onSpend, offPercent, total }
  }, [order.lineItems])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{order.poNumber}</span>
            <StatusBadge status={order.status} config={poStatusConfig} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{order.vendor.name}</span></div>
          {/* M6: orderDate is a @db.Date — UTC-pinned formatter */}
          <div className="flex justify-between"><span className="text-muted-foreground">Order Date</span><span>{formatCalendarDate(order.orderDate)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total Cost</span><span className="font-medium">{formatCurrency(Number(order.totalCost ?? 0), true)}</span></div>
          {order.contract && (
            <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span>{order.contract.name}</span></div>
          )}
          {/* Order details (2026-06-10): bill-only context fields persisted
              from the create form. Facility-side only — the vendor PO list
              deliberately excludes the patient fields. MRN masked to last 4. */}
          {(order.procedureDate || order.patientMrn || order.patientInitials ||
            order.departmentCode || order.glCode || order.paymentTerms ||
            order.billToAddress || order.specialInstructions || order.notes) && (
            <div className="space-y-2 border-t pt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Order details
              </p>
              {order.procedureDate && (
                <div className="flex justify-between"><span className="text-muted-foreground">Procedure Date</span><span>{formatCalendarDate(order.procedureDate)}</span></div>
              )}
              {order.patientMrn && (
                <div className="flex justify-between"><span className="text-muted-foreground">Patient MRN</span><span className="font-mono">{maskMrn(order.patientMrn)}</span></div>
              )}
              {order.patientInitials && (
                <div className="flex justify-between"><span className="text-muted-foreground">Patient Initials</span><span>{order.patientInitials}</span></div>
              )}
              {order.departmentCode && (
                <div className="flex justify-between"><span className="text-muted-foreground">Department Code</span><span>{order.departmentCode}</span></div>
              )}
              {order.glCode && (
                <div className="flex justify-between"><span className="text-muted-foreground">GL Code</span><span>{order.glCode}</span></div>
              )}
              {order.paymentTerms && (
                <div className="flex justify-between"><span className="text-muted-foreground">Payment Terms</span><span>{order.paymentTerms}</span></div>
              )}
              {order.billToAddress && (
                <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">Bill To</span><span className="text-right">{order.billToAddress}</span></div>
              )}
              {order.specialInstructions && (
                <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">Special Instructions</span><span className="text-right">{order.specialInstructions}</span></div>
              )}
              {order.notes && (
                <div className="flex justify-between gap-4"><span className="shrink-0 text-muted-foreground">Notes</span><span className="text-right">{order.notes}</span></div>
              )}
            </div>
          )}
          {nextStatuses.length > 0 && (
            <div className="flex gap-2 pt-2">
              {nextStatuses.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === "cancelled" ? "destructive" : "default"}
                  onClick={() =>
                    updateStatus.mutate(
                      { id: order.id, status: s },
                      // H4: this page is RSC-fed (order comes in as a prop),
                      // so refresh the route to reflect the new status.
                      { onSuccess: () => router.refresh() },
                    )
                  }
                  disabled={updateStatus.isPending}
                >
                  {poStatusConfig[s]?.label ?? s}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contract compliance summary */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">On-contract lines</p>
            <p className="text-2xl font-bold">{summary.onCount}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(summary.onSpend, true)} spend
            </p>
          </CardContent>
        </Card>
        <Card
          className={
            summary.offCount > 0
              ? "border-amber-200 dark:border-amber-900"
              : undefined
          }
        >
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">Off-contract lines</p>
            <p className="text-2xl font-bold">{summary.offCount}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(summary.offSpend, true)} spend
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-1">
            <p className="text-xs text-muted-foreground">
              Off-contract percentage
            </p>
            <p
              className={
                summary.offPercent > 0
                  ? "text-2xl font-bold text-amber-600 dark:text-amber-400"
                  : "text-2xl font-bold"
              }
            >
              {summary.offPercent.toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground">
              of total PO spend
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Line Items ({order.lineItems.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Item #</TableHead>
                {hasLotSerial && <TableHead>Lot #</TableHead>}
                {hasLotSerial && <TableHead>Serial #</TableHead>}
                <TableHead>Qty</TableHead>
                <TableHead>Unit Price</TableHead>
                <TableHead>Extended</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>Contract</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lineItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={hasLotSerial ? 9 : 7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No line items on this PO.
                  </TableCell>
                </TableRow>
              ) : (
                order.lineItems.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell>{li.inventoryDescription}</TableCell>
                    <TableCell>{li.vendorItemNo ?? "-"}</TableCell>
                    {hasLotSerial && (
                      <TableCell className="font-mono text-sm">
                        {li.lotNumber ?? "-"}
                      </TableCell>
                    )}
                    {hasLotSerial && (
                      <TableCell className="font-mono text-sm">
                        {li.serialNumber ?? "-"}
                      </TableCell>
                    )}
                    <TableCell>{li.quantity}</TableCell>
                    <TableCell>
                      {formatCurrency(Number(li.unitPrice), true)}
                    </TableCell>
                    <TableCell>
                      {formatCurrency(Number(li.extendedPrice), true)}
                    </TableCell>
                    <TableCell>{li.uom}</TableCell>
                    <TableCell>
                      <OnContractBadge isOffContract={li.isOffContract} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
