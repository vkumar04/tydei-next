"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { formatRebateMethodLabel } from "@/lib/contracts/rebate-method-label"
import { getAccrualTimeline } from "@/lib/actions/contracts/accrual"

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
  const termLabels = data.termLabels ?? []
  const isMultiTerm = termLabels.length > 1
  // Charles 2026-04-23 — column header advertises the reset cadence so
  // users don't misread a quarterly-eval contract's cumulative as
  // lifetime. `cumulativeReset` is undefined on empty-rows early returns
  // and "lifetime" for multi-term contracts.
  const resetLabel: Record<string, string> = {
    monthly: "month-to-date",
    quarterly: "quarter-to-date",
    semi_annual: "half-to-date",
    annual: "year-to-date",
    lifetime: "lifetime",
  }
  const cumulativeHeader =
    "cumulativeReset" in data && data.cumulativeReset
      ? `Cumulative (${resetLabel[data.cumulativeReset] ?? "lifetime"})`
      : "Cumulative"

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle>Accrual Timeline</CardTitle>
          <p className="text-xs text-muted-foreground pt-1">
            Method: {formatRebateMethodLabel(data.method, { short: true })}{" "}
            · Total accrued: {formatCurrency(totalAccrued)}
          </p>
          {isMultiTerm && (
            <p className="text-[11px] text-muted-foreground pt-0.5">
              Contract has {termLabels.length} rebate terms — rows expand to
              show each term&rsquo;s contribution.
            </p>
          )}
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
                <th className="py-2 text-right font-medium">{cumulativeHeader}</th>
                <th className="py-2 text-center font-medium">Tier</th>
                <th className="py-2 text-right font-medium">Rate</th>
                <th className="py-2 text-right font-medium">Accrued</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => {
                const contributions = row.termContributions ?? []
                // Only render per-term breakdown when the contract has
                // more than one rebate term AND at least one contribution
                // exists. Single-term contracts keep the compact display.
                const showBreakdown =
                  isMultiTerm && contributions.length > 0
                return (
                  <tr
                    key={row.month}
                    className="border-b last:border-0 hover:bg-muted/30 align-top"
                  >
                    <td className="py-2">{row.month}</td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(Number(row.spend))}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(Number(row.cumulativeSpend))}
                    </td>
                    <td className="py-2 text-center">
                      {showBreakdown ? (
                        <div className="flex flex-col items-center gap-0.5">
                          {contributions.map((c) => (
                            <Badge
                              key={c.termIndex}
                              variant="outline"
                              className="text-[10px]"
                            >
                              {c.tierAchieved > 0 ? `T${c.termIndex + 1}·${c.tierAchieved}` : "—"}
                            </Badge>
                          ))}
                        </div>
                      ) : row.tierAchieved > 0 ? (
                        <Badge variant="outline" className="text-xs">
                          {row.tierAchieved}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {showBreakdown ? (
                        <div className="flex flex-col gap-0.5 text-xs">
                          {contributions.map((c) => (
                            <span key={c.termIndex} className="tabular-nums">
                              <span className="text-muted-foreground mr-1">
                                {termLabels[c.termIndex]?.termName ?? `T${c.termIndex + 1}`}:
                              </span>
                              {Number(c.rebatePercent).toFixed(2)}%
                            </span>
                          ))}
                        </div>
                      ) : (
                        <>{Number(row.rebatePercent).toFixed(2)}%</>
                      )}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums">
                      {showBreakdown ? (
                        <div className="flex flex-col items-end gap-0.5 text-xs">
                          {contributions.map((c) => (
                            <span key={c.termIndex} className="tabular-nums">
                              {formatCurrency(Number(c.accruedAmount))}
                            </span>
                          ))}
                          <span className="border-t mt-0.5 pt-0.5 font-semibold">
                            {formatCurrency(Number(row.accruedAmount))}
                          </span>
                        </div>
                      ) : (
                        <>{formatCurrency(Number(row.accruedAmount))}</>
                      )}
                    </td>
                  </tr>
                )
              })}
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
