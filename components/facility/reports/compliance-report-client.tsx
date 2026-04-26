"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
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
import { queryKeys } from "@/lib/query-keys"
import { evaluatePurchaseCompliance } from "@/lib/actions/analytics/purchase-compliance"

const TODAY_ISO = () => new Date().toISOString().slice(0, 10)
const NINETY_DAYS_AGO_ISO = () => {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

function severityBadge(s: "ACCEPTABLE" | "WARNING" | "CRITICAL") {
  if (s === "CRITICAL") return <Badge variant="destructive">Critical</Badge>
  if (s === "WARNING") return <Badge variant="secondary">Warning</Badge>
  return <Badge variant="default">OK</Badge>
}

export function ComplianceReportClient({ facilityId }: { facilityId: string }) {
  const [from, setFrom] = useState<string>(NINETY_DAYS_AGO_ISO())
  const [to, setTo] = useState<string>(TODAY_ISO())

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.analytics.purchaseCompliance(facilityId, { from, to }),
    queryFn: () =>
      evaluatePurchaseCompliance({ fromDate: from, toDate: to, limit: 500 }),
  })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/reports">
            <Button variant="ghost" size="sm">
              <ChevronLeft className="mr-1 h-4 w-4" />
              Reports
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Per-Purchase Compliance Audit
            </h1>
            <p className="text-sm text-muted-foreground">
              Off-contract vendors, out-of-period purchases, unapproved items,
              and significant price variance.
            </p>
          </div>
        </div>
        <div className="flex items-end gap-3">
          <div className="grid gap-1">
            <Label className="text-xs" htmlFor="from">
              From
            </Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-xs" htmlFor="to">
              To
            </Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-40"
            />
          </div>
        </div>
      </div>

      {isLoading || !data ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Compliance Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{data.complianceRatePct}%</div>
              <p className="text-xs text-muted-foreground">
                {data.compliantPurchases.toLocaleString()} of{" "}
                {data.totalPurchases.toLocaleString()} purchases
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Critical</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">
                {data.criticalCount.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">violations</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Warnings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {data.warningCount.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">violations</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">By Type</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs">
                {Object.entries(data.byType).map(([t, n]) => (
                  <div key={t} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {t.replace(/_/g, " ").toLowerCase()}
                    </span>
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
                {Object.keys(data.byType).length === 0 ? (
                  <span className="text-muted-foreground">No violations</span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Audit Detail{" "}
            {isFetching ? (
              <span className="ml-2 text-xs text-muted-foreground">
                refreshing…
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="h-64 w-full" />
          ) : data.audits.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No purchases in the selected window.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Unit $</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Violations</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.audits.slice(0, 200).map((a) => (
                  <TableRow key={a.cogId}>
                    <TableCell className="font-mono text-xs">
                      {a.transactionDate.slice(0, 10)}
                    </TableCell>
                    <TableCell>{a.vendorName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.vendorItemNo ?? "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${a.unitCost.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {a.quantity}
                    </TableCell>
                    <TableCell>
                      {a.isCompliant ? (
                        <Badge variant="default">OK</Badge>
                      ) : (
                        <Badge variant="destructive">Violation</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {a.violations.length === 0 ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {a.violations.map((v, i) => (
                            <div
                              key={i}
                              className="flex items-center gap-2 text-xs"
                            >
                              {severityBadge(v.severity)}
                              <span>{v.message}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
