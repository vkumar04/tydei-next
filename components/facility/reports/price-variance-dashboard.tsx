"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancies } from "@/lib/actions/reports"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import { AlertTriangle, DollarSign, TrendingUp } from "lucide-react"

// ─── Severity helpers ───────────────────────────────────────────

type Severity = "minor" | "moderate" | "major"

function severityFor(variancePercent: number | null | undefined): Severity | null {
  if (variancePercent === null || variancePercent === undefined) return null
  const abs = Math.abs(variancePercent)
  if (abs < 2) return "minor"
  if (abs < 10) return "moderate"
  return "major"
}

const SEVERITY_META: Record<
  Severity,
  { label: string; className: string; dot: string }
> = {
  minor: {
    label: "Minor (<2%)",
    className:
      "bg-green-100 text-green-700 border-0 dark:bg-green-900 dark:text-green-300",
    dot: "bg-green-500",
  },
  moderate: {
    label: "Moderate (2–10%)",
    className:
      "bg-amber-100 text-amber-700 border-0 dark:bg-amber-900 dark:text-amber-300",
    dot: "bg-amber-500",
  },
  major: {
    label: "Major (≥10%)",
    className:
      "bg-red-100 text-red-700 border-0 dark:bg-red-900 dark:text-red-300",
    dot: "bg-red-500",
  },
}

function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <Badge className={SEVERITY_META[severity].className}>
      {SEVERITY_META[severity].label}
    </Badge>
  )
}

// ─── Component ──────────────────────────────────────────────────

interface PriceVarianceDashboardProps {
  facilityId: string
}

export function PriceVarianceDashboard({
  facilityId,
}: PriceVarianceDashboardProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.priceDiscrepancies(facilityId),
    queryFn: () => getPriceDiscrepancies(facilityId),
  })

  const rows = data ?? []

  const analysis = useMemo(() => {
    // Bucket variance rows by severity + by vendor.
    const severityBuckets: Record<
      Severity,
      { count: number; dollarImpact: number }
    > = {
      minor: { count: 0, dollarImpact: 0 },
      moderate: { count: 0, dollarImpact: 0 },
      major: { count: 0, dollarImpact: 0 },
    }
    type VendorBucket = {
      vendorId: string
      vendorName: string
      overchargeTotal: number
      underchargeTotal: number
      count: number
      majorCount: number
    }
    const vendorMap = new Map<string, VendorBucket>()
    const majorRows: Array<{
      id: string
      invoiceNumber: string
      invoiceId: string
      vendorName: string
      itemDescription: string
      vendorItemNo: string | null
      variancePercent: number
      dollarImpact: number
    }> = []

    for (const row of rows) {
      const severity = severityFor(row.variancePercent)
      if (!severity) continue
      const dollarImpact =
        row.contractPrice != null
          ? (row.invoicePrice - row.contractPrice) * row.quantity
          : 0
      severityBuckets[severity].count += 1
      severityBuckets[severity].dollarImpact += dollarImpact

      const bucket =
        vendorMap.get(row.vendorId) ??
        ({
          vendorId: row.vendorId,
          vendorName: row.vendorName,
          overchargeTotal: 0,
          underchargeTotal: 0,
          count: 0,
          majorCount: 0,
        } as VendorBucket)
      if (dollarImpact > 0) bucket.overchargeTotal += dollarImpact
      else bucket.underchargeTotal += Math.abs(dollarImpact)
      bucket.count += 1
      if (severity === "major") bucket.majorCount += 1
      vendorMap.set(row.vendorId, bucket)

      if (severity === "major" && row.variancePercent !== null) {
        majorRows.push({
          id: row.id,
          invoiceNumber: row.invoiceNumber,
          invoiceId: row.invoiceId,
          vendorName: row.vendorName,
          itemDescription: row.itemDescription,
          vendorItemNo: row.vendorItemNo,
          variancePercent: row.variancePercent,
          dollarImpact,
        })
      }
    }

    const vendorRows = [...vendorMap.values()].sort(
      (a, b) => b.overchargeTotal - a.overchargeTotal
    )

    majorRows.sort((a, b) => Math.abs(b.dollarImpact) - Math.abs(a.dollarImpact))

    return {
      severityBuckets,
      vendorRows,
      majorRows: majorRows.slice(0, 25),
      totalOvercharge: vendorRows.reduce(
        (sum, v) => sum + v.overchargeTotal,
        0
      ),
      totalUndercharge: vendorRows.reduce(
        (sum, v) => sum + v.underchargeTotal,
        0
      ),
    }
  }, [rows])

  const chartData = (["minor", "moderate", "major"] as Severity[]).map(
    (severity) => ({
      severity: SEVERITY_META[severity].label,
      Count: analysis.severityBuckets[severity].count,
      Impact: analysis.severityBuckets[severity].dollarImpact,
    })
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[320px] rounded-xl" />
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="rounded-full bg-muted p-4 mb-4">
            <AlertTriangle className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            No variance data yet
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            Once invoices are imported and matched against contract pricing,
            price-variance rows will appear here grouped by severity.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Severity totals */}
      <div className="grid gap-4 md:grid-cols-3">
        {(["major", "moderate", "minor"] as Severity[]).map((severity) => {
          const bucket = analysis.severityBuckets[severity]
          const meta = SEVERITY_META[severity]
          return (
            <Card key={severity}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
                      <p className="text-sm text-muted-foreground">
                        {meta.label}
                      </p>
                    </div>
                    <p className="text-2xl font-bold">{bucket.count}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatCurrency(bucket.dollarImpact, true)} impact
                    </p>
                  </div>
                  <div className="rounded-lg bg-muted/50 p-2.5">
                    {severity === "major" ? (
                      <AlertTriangle className="h-5 w-5 text-red-500" />
                    ) : severity === "moderate" ? (
                      <TrendingUp className="h-5 w-5 text-amber-500" />
                    ) : (
                      <DollarSign className="h-5 w-5 text-green-500" />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Variance by severity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="severity" className="text-xs" />
                <YAxis yAxisId="left" className="text-xs" />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  className="text-xs"
                  tickFormatter={(v: number) => formatCurrency(v, true)}
                />
                <RechartsTooltip
                  formatter={(value, name) => {
                    const numeric =
                      typeof value === "number" ? value : Number(value ?? 0)
                    if (name === "Impact") {
                      return [formatCurrency(numeric, true), "Dollar impact"]
                    }
                    return [numeric, String(name ?? "")]
                  }}
                />
                <Bar
                  yAxisId="left"
                  dataKey="Count"
                  fill="var(--chart-8)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="right"
                  dataKey="Impact"
                  fill="var(--destructive)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Per-vendor totals */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor totals</CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.vendorRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No vendor-level variance totals to display.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Overcharge</TableHead>
                  <TableHead className="text-right">Undercharge</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Major</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.vendorRows.slice(0, 20).map((v) => (
                  <TableRow key={v.vendorId}>
                    <TableCell className="font-medium">
                      {v.vendorName}
                    </TableCell>
                    <TableCell className="text-right text-red-600 dark:text-red-400">
                      {formatCurrency(v.overchargeTotal, true)}
                    </TableCell>
                    <TableCell className="text-right text-green-600 dark:text-green-400">
                      {formatCurrency(v.underchargeTotal, true)}
                    </TableCell>
                    <TableCell className="text-right">{v.count}</TableCell>
                    <TableCell className="text-right">
                      {v.majorCount > 0 ? (
                        <Badge className="border-0 bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">
                          {v.majorCount}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Major variance drill-down */}
      <Card>
        <CardHeader>
          <CardTitle>Top major-severity lines</CardTitle>
        </CardHeader>
        <CardContent>
          {analysis.majorRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No major-severity lines detected. Good news!
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Variance %</TableHead>
                  <TableHead className="text-right">Dollar impact</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analysis.majorRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="max-w-[240px]">
                      <span className="block truncate font-medium">
                        {row.itemDescription}
                      </span>
                      {row.vendorItemNo && (
                        <span className="text-xs text-muted-foreground">
                          #{row.vendorItemNo}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{row.vendorName}</TableCell>
                    <TableCell>{row.invoiceNumber}</TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-red-600 dark:text-red-400">
                        +{formatPercent(row.variancePercent)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(row.dollarImpact, true)}
                    </TableCell>
                    <TableCell>
                      <SeverityBadge severity="major" />
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
