"use client"

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

interface PODetailViewProps {
  order: PODetail
}

export function PODetailView({ order }: PODetailViewProps) {
  const updateStatus = useUpdatePOStatus()
  const nextStatuses = STATUS_FLOW[order.status] ?? []

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {order.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell>{li.inventoryDescription}</TableCell>
                  <TableCell>{li.vendorItemNo ?? "-"}</TableCell>
                  <TableCell>{li.quantity}</TableCell>
                  <TableCell>{formatCurrency(Number(li.unitPrice), true)}</TableCell>
                  <TableCell>{formatCurrency(Number(li.extendedPrice), true)}</TableCell>
                  <TableCell>{li.uom}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
