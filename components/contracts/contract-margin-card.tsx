"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getContractMarginAnalysis } from "@/lib/actions/contracts"

interface ContractMarginCardProps {
  contractId: string
  /** Max number of procedures to show. Default 5. */
  limit?: number
}

export function ContractMarginCard({ contractId, limit = 5 }: ContractMarginCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-margin-analysis", contractId],
    queryFn: () => getContractMarginAnalysis(contractId),
  })

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>True Margin Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (data.procedures.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>True Margin Analysis</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          No case-level supply usage linked to this contract yet — margin
          analysis appears once cases reference contract supplies.
        </CardContent>
      </Card>
    )
  }

  const top = data.procedures.slice(0, limit)

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>True Margin Analysis</CardTitle>
          <p className="text-xs text-muted-foreground pt-1">
            Top {top.length} procedures by contract supply spend · rebate
            allocated proportional to each procedure&rsquo;s share
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          Rebate pool: {formatCurrency(Number(data.totalRebate))}
        </Badge>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">CPT</th>
              <th className="py-2 text-right font-medium">Cases</th>
              <th className="py-2 text-right font-medium">Supply Spend</th>
              <th className="py-2 text-right font-medium">Rebate Alloc.</th>
              <th className="py-2 text-right font-medium">Std Margin</th>
              <th className="py-2 text-right font-medium">True Margin</th>
              <th className="py-2 text-right font-medium">Uplift</th>
            </tr>
          </thead>
          <tbody>
            {top.map((p) => {
              const uplift =
                p.standardMarginPercent !== null && p.trueMarginPercent !== null
                  ? Number(p.trueMarginPercent) - Number(p.standardMarginPercent)
                  : null
              return (
                <tr key={p.cptCode} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="py-2 font-mono text-xs">{p.cptCode}</td>
                  <td className="py-2 text-right tabular-nums">{p.caseCount}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(Number(p.vendorSpend))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {formatCurrency(Number(p.rebateAllocation))}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {p.standardMarginPercent !== null
                      ? `${Number(p.standardMarginPercent).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-2 text-right font-medium tabular-nums">
                    {p.trueMarginPercent !== null
                      ? `${Number(p.trueMarginPercent).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {uplift !== null && uplift > 0 ? (
                      <span className="text-green-600 dark:text-green-400">
                        +{uplift.toFixed(1)}pp
                      </span>
                    ) : uplift !== null && uplift < 0 ? (
                      <span className="text-red-600 dark:text-red-400">
                        {uplift.toFixed(1)}pp
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
