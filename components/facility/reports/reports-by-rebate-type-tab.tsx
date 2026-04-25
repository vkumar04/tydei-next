"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { formatCurrency } from "@/lib/formatting"
import { getRebateBreakdownByType } from "@/lib/actions/reports/by-rebate-type"

/**
 * Charles 2026-04-25 (audit follow-up): facility-wide rebate
 * breakdown by termType. Reads persisted Rebate rows + parses each
 * row's auto-* notes prefix to attribute it to the writer that
 * produced it (spend / volume / PO / threshold / invoice / manual).
 */
export function ReportsByRebateTypeTab() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "by-rebate-type"],
    queryFn: () => getRebateBreakdownByType(),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Earned Rebates by Type</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No rebate rows yet. Once accruals run on your active contracts,
          this view will show the breakdown by term type.
        </CardContent>
      </Card>
    )
  }
  const total = data.reduce((s, r) => s + r.earned, 0)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Earned Rebates by Type</CardTitle>
        <CardDescription>
          Lifetime earned rebates grouped by the underlying term&apos;s
          type. The writer that produced each row is inferred from the
          row&apos;s notes prefix.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 pr-3 text-left font-medium">Term type</th>
                <th className="py-2 pr-3 text-right font-medium">Earned</th>
                <th className="py-2 pr-3 text-right font-medium">Collected</th>
                <th className="py-2 pr-3 text-right font-medium">% of total</th>
                <th className="py-2 pr-3 text-right font-medium">Contracts</th>
                <th className="py-2 text-right font-medium">Rows</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const pct = total > 0 ? (row.earned / total) * 100 : 0
                return (
                  <tr key={row.termType} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium capitalize">
                        {row.termType.replace(/_/g, " ")}
                      </span>
                      {row.termType === "compliance_or_market_share" && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          inferred from notes prefix
                        </Badge>
                      )}
                      {row.termType === "manual" && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          user-logged rows
                        </Badge>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.earned)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.collected)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {pct.toFixed(1)}%
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.contractCount}
                    </td>
                    <td className="py-2 text-right tabular-nums text-muted-foreground">
                      {row.rowCount}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td className="py-2 pr-3 font-semibold">Total</td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                  {formatCurrency(total)}
                </td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">
                  {formatCurrency(
                    data.reduce((s, r) => s + r.collected, 0),
                  )}
                </td>
                <td className="py-2 pr-3" />
                <td className="py-2 pr-3" />
                <td className="py-2" />
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
