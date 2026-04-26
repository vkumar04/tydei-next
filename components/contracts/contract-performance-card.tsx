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
import { Activity, AlertTriangle, PieChart, Target } from "lucide-react"
import { getContractPerformance } from "@/lib/actions/contracts/performance-read"
import { getCategoryMarketShareForVendor } from "@/lib/actions/cog/category-market-share"

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
  vendorId,
  productCategory,
}: {
  contractId: string
  /** Optional — when present, the card adds a Market Share row scoped
   *  to this vendor at the active facility. Pulled from COG live so
   *  the metric reflects actual purchase mix. */
  vendorId?: string
  /** Optional — when present, narrows the Market Share row to the
   *  contract's product category (instead of summing across all
   *  categories the vendor sells in). */
  productCategory?: string | null
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-performance", contractId],
    queryFn: () => getContractPerformance(contractId),
  })

  // Market share is fetched independently so it can degrade to a "—"
  // row when the vendor has no categorized COG, without blocking the
  // utilization + risk render.
  const { data: shareData } = useQuery({
    queryKey: ["contract-performance-share", vendorId, contractId],
    queryFn: () =>
      vendorId
        ? getCategoryMarketShareForVendor({ vendorId, contractId })
        : Promise.resolve(null),
    enabled: !!vendorId,
  })

  if (isLoading || !data) return null
  if (!data.utilization && !data.renewalRisk && !vendorId) return null

  const util = data.utilization
  const risk = data.renewalRisk

  // Resolve the market-share row for this contract's category. If the
  // contract has no productCategory (capital, service), fall back to
  // the highest-share category the vendor sells in at this facility —
  // gives the user something useful instead of an empty row.
  const shareRow = shareData
    ? productCategory
      ? shareData.rows.find((r) => r.category === productCategory) ?? null
      : shareData.rows[0] ?? null
    : null

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
          Rebate utilization, market share, and renewal risk at a glance.
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
        {vendorId && (
          <div className="space-y-2 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <PieChart className="h-3.5 w-3.5" />
                Market share
                {productCategory && (
                  <span className="text-xs font-normal text-muted-foreground">
                    · {productCategory}
                  </span>
                )}
              </div>
              {shareRow ? (
                <span className="text-lg font-semibold tabular-nums">
                  {shareRow.sharePct.toFixed(1)}%
                </span>
              ) : (
                <span className="text-sm text-muted-foreground">—</span>
              )}
            </div>
            {shareRow ? (
              <>
                <Progress value={Math.min(100, shareRow.sharePct)} />
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(shareRow.vendorSpend)} of{" "}
                  {formatCurrency(shareRow.categoryTotal)} ·{" "}
                  {shareRow.competingVendors === 1
                    ? "Sole supplier"
                    : `${shareRow.competingVendors} vendors competing`}
                  {shareRow.commitmentPct != null && (
                    <>
                      {" "}
                      · target {shareRow.commitmentPct.toFixed(1)}%
                      {shareRow.sharePct >= shareRow.commitmentPct ? (
                        <span className="text-emerald-600"> (met)</span>
                      ) : (
                        <span className="text-amber-600">
                          {" "}
                          ({(shareRow.commitmentPct - shareRow.sharePct).toFixed(1)}% short)
                        </span>
                      )}
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                {!shareData
                  ? "Loading…"
                  : shareData.totalVendorSpend === 0
                    ? "No spend recorded for this vendor at this facility in the last 12 months."
                    : productCategory
                      ? `No categorized COG for ${productCategory}. Total un-categorized vendor spend: ${formatCurrency(shareData.uncategorizedSpend)}.`
                      : "Vendor spend exists but isn't categorized — categorize the COG import to see share by category."}
              </p>
            )}
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
