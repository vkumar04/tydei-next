"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"
import { getVendorPurchaseLeakage } from "@/lib/actions/analytics/vendor-purchase-leakage"

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)
const NINETY_DAYS_AGO_ISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

const REASON_LABEL: Record<string, string> = {
  OFF_CONTRACT: "Off contract",
  OUT_OF_PERIOD: "Out of period",
  PRICE_VARIANCE: "Price variance",
}

function reasonBadge(reason: string) {
  if (reason === "OFF_CONTRACT")
    return (
      <Badge className="bg-red-500/15 text-red-600 dark:text-red-400 border-0">
        {REASON_LABEL[reason]}
      </Badge>
    )
  if (reason === "OUT_OF_PERIOD")
    return (
      <Badge className="bg-orange-500/15 text-orange-600 dark:text-orange-400 border-0">
        {REASON_LABEL[reason]}
      </Badge>
    )
  return (
    <Badge className="bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-0">
      {REASON_LABEL[reason]}
    </Badge>
  )
}

/**
 * Vendor-side leakage report — COG records attributed to this vendor
 * that are off-contract, out-of-period, or significantly off-price.
 * Aimed at sales / contract-management teams who want to pursue
 * under-utilized contracts.
 */
export function VendorPurchaseLeakageCard() {
  const [from, setFrom] = useState(NINETY_DAYS_AGO_ISO())
  const [to, setTo] = useState(TODAY_ISO())

  const { data, isLoading } = useQuery({
    queryKey: ["vendor", "purchaseLeakage", { from, to }],
    queryFn: () =>
      getVendorPurchaseLeakage({ fromDate: from, toDate: to, limit: 250 }),
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex items-end justify-between gap-4">
          <div>
            <CardTitle className="text-base">
              Purchase Leakage Audit
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Where your product is being bought off-contract, out of period,
              or with significant price variance.
            </p>
          </div>
          <div className="flex items-end gap-3">
            <div className="grid gap-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-36"
              />
            </div>
            <div className="grid gap-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-36"
              />
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading || !data ? (
          <Skeleton className="h-48 w-full" />
        ) : data.totalRows === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing leaking in the selected window — every purchase of your
            product was on-contract and at-price. 🎉
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {Object.entries(data.byReason).map(([reason, count]) => (
                <div
                  key={reason}
                  className="rounded-lg border p-3"
                >
                  <p className="text-xs text-muted-foreground">
                    {REASON_LABEL[reason] ?? reason}
                  </p>
                  <p className="text-2xl font-semibold">
                    {count.toLocaleString()}
                  </p>
                </div>
              ))}
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Facility</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit $</TableHead>
                  <TableHead className="text-right">Extended $</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.slice(0, 100).map((r) => (
                  <TableRow key={r.cogId}>
                    <TableCell className="font-mono text-xs">
                      {r.transactionDate.slice(0, 10)}
                    </TableCell>
                    <TableCell>{r.facilityName}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.vendorItemNo ?? "—"}
                      {r.inventoryDescription ? (
                        <div className="text-muted-foreground truncate max-w-[220px]">
                          {r.inventoryDescription}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {r.quantity}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${r.unitCost.toFixed(2)}
                      {r.contractPrice != null ? (
                        <div className="text-xs text-muted-foreground">
                          contract ${r.contractPrice.toFixed(2)}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(r.extendedPrice)}
                    </TableCell>
                    <TableCell>{reasonBadge(r.reason)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
