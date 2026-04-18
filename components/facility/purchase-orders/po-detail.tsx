"use client"

import { useMemo } from "react"
import type { PurchaseOrder, POLineItem, Vendor, Contract } from "@prisma/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { poStatusConfig } from "@/lib/constants"
import { StatusBadge } from "@/components/shared/badges/status-badge"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { useUpdatePOStatus } from "@/hooks/use-purchase-orders"
import type { POStatus } from "@prisma/client"

// ─── Types ──────────────────────────────────────────────────────

type PODetail = PurchaseOrder & {
  vendor: Pick<Vendor, "id" | "name">
  contract: Pick<Contract, "id" | "name"> | null
  lineItems: POLineItem[]
}

const STATUS_FLOW: Record<string, POStatus[]> = {
  draft: ["pending"],
  pending: ["approved", "cancelled"],
  approved: ["sent", "cancelled"],
  sent: ["completed"],
}

// ─── Sub-components ─────────────────────────────────────────────

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
  const updateStatus = useUpdatePOStatus()
  const nextStatuses = STATUS_FLOW[order.status] ?? []

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
          <div className="flex justify-between"><span className="text-muted-foreground">Order Date</span><span>{formatDate(order.orderDate)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Total Cost</span><span className="font-medium">{formatCurrency(Number(order.totalCost ?? 0), true)}</span></div>
          {order.contract && (
            <div className="flex justify-between"><span className="text-muted-foreground">Contract</span><span>{order.contract.name}</span></div>
          )}
          {nextStatuses.length > 0 && (
            <div className="flex gap-2 pt-2">
              {nextStatuses.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === "cancelled" ? "destructive" : "default"}
                  onClick={() => updateStatus.mutate({ id: order.id, status: s })}
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
                    colSpan={7}
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
