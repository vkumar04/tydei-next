"use client"

import { useQuery } from "@tanstack/react-query"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { formatCurrency } from "@/lib/formatting"
import { Activity, AlertTriangle, Target } from "lucide-react"
import { getContractPerformance } from "@/lib/actions/contracts/performance-read"

/**
 * Surfaces the v0-aligned performance helpers on the contract detail
 * page:
 *   - calculateRebateUtilization — actual rebate vs max-tier potential
 *   - calculateRenewalRisk       — weighted 0-100 composite
 *
 * Hidden on contract types that don't carry tiered rebates (capital,
 * service, pricing_only) — the helpers return trivially and there's
 * nothing meaningful to show.
 */
export function ContractPerformanceCard({
  contractId,
}: {
  contractId: string
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-performance", contractId],
    queryFn: () => getContractPerformance(contractId),
  })

  if (isLoading || !data) return null
  if (!data.utilization && !data.renewalRisk) return null

  const util = data.utilization
  const risk = data.renewalRisk

  const riskBadgeVariant =
    risk?.riskLevel === "high"
      ? "destructive"
      : risk?.riskLevel === "medium"
        ? "secondary"
        : "outline"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4" /> Contract performance
        </CardTitle>
        <CardDescription>
          Rebate utilization and renewal risk at a glance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {util && (
          <div className="space-y-2 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Target className="h-3.5 w-3.5" />
                Rebate utilization
              </div>
              <span className="text-lg font-semibold tabular-nums">
                {util.utilizationPct.toFixed(1)}%
              </span>
            </div>
            <Progress value={Math.min(100, util.utilizationPct)} />
            <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
              <div>
                <p>Actual rebate</p>
                <p className="font-medium text-foreground tabular-nums">
                  {formatCurrency(util.actualRebate)}
                </p>
              </div>
              <div>
                <p>Max at top tier</p>
                <p className="font-medium text-foreground tabular-nums">
                  {formatCurrency(util.maxPossibleRebate)}
                </p>
              </div>
              <div>
                <p>Missed</p>
                <p className="font-medium text-foreground tabular-nums">
                  {formatCurrency(util.missedRebate)}
                </p>
              </div>
            </div>
            {util.additionalSpendForMaxTier > 0 && (
              <p className="text-xs text-muted-foreground">
                Additional spend to reach top tier:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(util.additionalSpendForMaxTier)}
                </span>
              </p>
            )}
            {/*
             * Charles 2026-04-24: without this footnote "Missed $0" on a
             * cumulative/retroactive contract reads like a bug — the card
             * gives no hint that under retroactive math, crossing the top
             * tier by definition earns the top rate on all spend. Showing
             * the active method + tier count makes the math legible.
             */}
            <p className="text-xs text-muted-foreground">
              Method:{" "}
              <span className="font-medium text-foreground">
                {util.rebateMethod === "marginal"
                  ? "Tiered (per-slice)"
                  : "Retroactive (dollar-one)"}
              </span>{" "}
              · {util.tierCount} tier{util.tierCount === 1 ? "" : "s"}
              {util.rebateMethod === "cumulative" && util.missedRebate === 0 && util.tierCount > 1 && (
                <>
                  {" "}
                  · Missed $0 is by design under retroactive math once the
                  top tier is crossed.
                </>
              )}
              {util.tierCount === 1 && (
                <>
                  {" "}
                  · Single-tier contract: actual always equals max.
                </>
              )}
            </p>
          </div>
        )}
        {risk && (
          <div className="space-y-2 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <AlertTriangle className="h-3.5 w-3.5" />
                Renewal risk
              </div>
              <Badge variant={riskBadgeVariant} className="text-xs">
                {risk.riskLevel}
              </Badge>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {Math.round(risk.riskScore)}
              </span>
              <span className="text-xs text-muted-foreground">/ 100</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Weighted composite — days-to-expiration 20% · compliance 25% ·
              price variance 20% · responsiveness 15% · rebate utilization
              10% · open issues 10%.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
