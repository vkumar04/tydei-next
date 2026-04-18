"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getAccrualTimeline } from "@/lib/actions/contracts"

interface ContractAccrualTimelineProps {
  contractId: string
}

export function ContractAccrualTimeline({
  contractId,
}: ContractAccrualTimelineProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-accrual-timeline", contractId],
    queryFn: () => getAccrualTimeline(contractId),
  })

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accrual Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (data.rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Accrual Timeline</CardTitle>
        </CardHeader>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No tiers defined yet — add terms and tiers to see accrual schedule.
        </CardContent>
      </Card>
    )
  }

  const totalAccrued = data.rows.reduce((s, r) => s + Number(r.accruedAmount), 0)
  const latest = data.rows[data.rows.length - 1]

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Accrual Timeline</CardTitle>
          <p className="text-xs text-muted-foreground pt-1">
            Method: {data.method === "marginal" ? "Marginal (bracket)" : "Cumulative"}{" "}
            · Total accrued: {formatCurrency(totalAccrued)}
          </p>
        </div>
        <Badge variant="secondary" className="shrink-0">
          {data.rows.length} {data.rows.length === 1 ? "month" : "months"}
        </Badge>
      </CardHeader>
      <CardContent>
        <div className="max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Month</th>
                <th className="py-2 text-right font-medium">Spend</th>
                <th className="py-2 text-right font-medium">Cumulative</th>
                <th className="py-2 text-center font-medium">Tier</th>
                <th className="py-2 text-right font-medium">Rate</th>
                <th className="py-2 text-right font-medium">Accrued</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr
                  key={row.month}
                  className="border-b last:border-0 hover:bg-muted/30"
                >
                  <td className="py-2">{row.month}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(Number(row.spend))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(Number(row.cumulativeSpend))}
                  </td>
                  <td className="py-2 text-center">
                    {row.tierAchieved > 0 ? (
                      <Badge variant="outline" className="text-xs">
                        {row.tierAchieved}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {Number(row.rebatePercent).toFixed(2)}%
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {formatCurrency(Number(row.accruedAmount))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t font-medium">
                <td colSpan={5} className="py-2 text-right text-xs text-muted-foreground">
                  Latest cumulative spend: {formatCurrency(Number(latest.cumulativeSpend))}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCurrency(totalAccrued)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
