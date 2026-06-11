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
import { getCarveOutRebate } from "@/lib/actions/contracts/carve-out"
import { Scissors } from "lucide-react"

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
  productCategories,
}: {
  contractId: string
  /** Optional — when present, the card adds a Market Share row scoped
   *  to this vendor at the active facility. Pulled from COG live so
   *  the metric reflects actual purchase mix. */
  vendorId?: string
  /** Deprecated — kept for callers that still pass a single category.
   *  Prefer `productCategories` so all of the contract's categories
   *  get their own market-share row. */
  productCategory?: string | null
  /** Bug 2026-05-20 (Vick): the card used to pick the first/alphabetical
   *  category and show "No categorized COG for X" while other in-scope
   *  categories had real data. Pass the full list and we render one
   *  market-share sub-row per category that has presence. */
  productCategories?: string[]
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

  // Bug 8 (Vick 2026-06-02): "No carve out calculations are going up in
  // Performance." Carve-out contracts aren't tiered, so `utilization` is
  // null and the card showed nothing about the carve-out rebate. Pull it
  // here so a carve-out / tie-in contract's Performance tab surfaces the
  // earned carve-out rebate alongside utilization + share.
  const { data: carveOut } = useQuery({
    queryKey: ["contract-performance-carveout", contractId],
    queryFn: () => getCarveOutRebate(contractId),
  })

  if (isLoading || !data) return null
  const carveOutLineCount = carveOut?.carveOutLines?.length ?? 0
  const hasCarveOut =
    !!carveOut && (carveOut.rebateEarned > 0 || carveOutLineCount > 0)
  if (!data.utilization && !data.renewalRisk && !vendorId && !hasCarveOut)
    return null

  const util = data.utilization
  const risk = data.renewalRisk

  // Resolve the market-share row for this contract's category. If the
  // contract has no productCategory (capital, service), fall back to
  // the highest-share category the vendor sells in at this facility —
  // gives the user something useful instead of an empty row.
  //
  // 2026-04-26 (Charles prod feedback): the comparison is normalized
  // because category strings drift between sources. e.g. a contract
  // can carry productCategory.name="Ortho-Extremity" while the COG
  // import stored "ortho-extremity" or "Ortho-Extremity " (trailing
  // space). Without normalization the standalone Market Share card
  // surfaced data the contract-narrowed row reported as missing —
  // the underlying fix is import-time category validation (separate
  // commit), but this normalization prevents the UI from lying when
  // the data drift is just whitespace/case.
  const normalizeCategory = (s: string | null | undefined) =>
    (s ?? "").trim().toLowerCase()
  // Bug 2026-05-20 (Vick): build the list of rows to render. Prefer
  // the multi-category list; fall back to the legacy single-category
  // narrowing; final fallback is "all categories the vendor sells in".
  const targets =
    productCategories && productCategories.length > 0
      ? productCategories.map(normalizeCategory)
      : productCategory
        ? [normalizeCategory(productCategory)]
        : []
  const shareRows = shareData
    ? targets.length > 0
      ? targets
          .map((t) => ({
            target: t,
            row: shareData.rows.find(
              (r) => normalizeCategory(r.category) === t,
            ) ?? null,
          }))
      : shareData.rows.slice(0, 1).map((r) => ({ target: normalizeCategory(r.category), row: r }))
    : []
  // Used by the empty-state copy below.
  const anyShareRow = shareRows.find((s) => s.row != null)?.row ?? null

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
                {/* Bug 4/6/7 (Vick 2026-06-01): this is the tier engine run
                    on the contract's TOTAL spend — a projection of what that
                    spend earns at the tier, NOT the earned-to-date figure in
                    the header "Rebates Earned" card (which counts only closed
                    periods). Labeling it "Actual rebate" made the two numbers
                    look contradictory. */}
                <p>Rebate at current spend</p>
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
              Projection of what current spend earns at the tier — not
              earned-to-date. The header &ldquo;Rebates Earned&rdquo; counts
              only closed periods, so it&rsquo;s usually lower.
            </p>
            <p className="text-xs text-muted-foreground">
              Method:{" "}
              <span className="font-medium text-foreground">
                {util.rebateMethod === "marginal"
                  ? "Bracketed (per-tier)"
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
        {hasCarveOut && carveOut && (
          <div className="space-y-2 rounded-md border bg-card p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Scissors className="h-3.5 w-3.5" />
                Carve-out rebate
              </div>
              <span className="text-lg font-semibold tabular-nums">
                {formatCurrency(carveOut.rebateEarned)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {/* Carve-out = per-SKU rate from the pricing file applied to
                  matched spend. Distinct from tiered rebates above. */}
              {carveOutLineCount} carved-out SKU
              {carveOutLineCount === 1 ? "" : "s"} ·{" "}
              {formatCurrency(carveOut.eligibleSpend)} eligible spend
            </p>
            {/* 2026-06-08 (Charles "rebate utilization not calculating"):
                tier utilization is meaningless for a carve-out, so the tile
                above hides itself. Show the blended effective rate
                (rebate ÷ eligible spend) — the carve-out analogue of
                utilization — so the Performance tab still surfaces a rate. */}
            {carveOut.eligibleSpend > 0 && (
              <p className="text-xs text-muted-foreground">
                Effective carve-out rate:{" "}
                <span className="font-medium tabular-nums text-foreground">
                  {(
                    (carveOut.rebateEarned / carveOut.eligibleSpend) *
                    100
                  ).toFixed(1)}
                  %
                </span>{" "}
                of eligible spend
              </p>
            )}
          </div>
        )}
        {vendorId && (
          <div className="space-y-2">
            {shareRows.length === 0 || !anyShareRow ? (
              <div className="space-y-2 rounded-md border bg-card p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <PieChart className="h-3.5 w-3.5" />
                    Market share
                  </div>
                  <span className="text-sm text-muted-foreground">—</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {!shareData
                    ? "Loading…"
                    : shareData.totalVendorSpend === 0
                      ? "No spend recorded for this vendor at this facility in the last 12 months."
                      : `No categorized COG for ${
                          productCategories && productCategories.length > 0
                            ? productCategories.join(", ")
                            : productCategory ?? "this vendor"
                        }. Total un-categorized vendor spend: ${formatCurrency(shareData.uncategorizedSpend)}.`}
                </p>
              </div>
            ) : (
              <>
                {shareRows
                  .filter(({ row }) => row !== null)
                  .map(({ target, row }, idx) => {
                const label =
                  row?.category ??
                  productCategories?.find(
                    (c) => normalizeCategory(c) === target,
                  ) ??
                  productCategory ??
                  ""
                return (
                  <div
                    key={`${target}-${idx}`}
                    className="space-y-2 rounded-md border bg-card p-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <PieChart className="h-3.5 w-3.5" />
                        Market share
                        {label && (
                          <span className="text-xs font-normal text-muted-foreground">
                            · {label}
                          </span>
                        )}
                      </div>
                      {row ? (
                        <span className="text-lg font-semibold tabular-nums">
                          {row.sharePct.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </div>
                    {row ? (
                      <>
                        <Progress value={Math.min(100, row.sharePct)} />
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(row.vendorSpend)} of{" "}
                          {formatCurrency(row.categoryTotal)} ·{" "}
                          {row.competingVendors === 1
                            ? "Sole supplier"
                            : `${row.competingVendors} vendors competing`}
                          {row.commitmentPct != null && (
                            <>
                              {" "}
                              · target {row.commitmentPct.toFixed(1)}%
                              {row.sharePct >= row.commitmentPct ? (
                                <span className="text-emerald-600"> (met)</span>
                              ) : (
                                <span className="text-amber-600">
                                  {" "}
                                  ({(row.commitmentPct - row.sharePct).toFixed(1)}% short)
                                </span>
                              )}
                            </>
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No categorized COG for {label}.
                      </p>
                    )}
                  </div>
                )
              })}
                {/* Charles 2026-06-10 ("categories still showing ones that
                    are mapped out"): categories with zero categorized COG
                    used to render one dead "No categorized COG for X" card
                    EACH — on the Mako tie-in that was four noise rows. They
                    collapse into a single compact footnote; the categories
                    are still named so the data gap stays visible. */}
                {(() => {
                  const dead = shareRows
                    .filter(({ row }) => row === null)
                    .map(
                      ({ target }) =>
                        productCategories?.find(
                          (c) => normalizeCategory(c) === target,
                        ) ?? target,
                    )
                  return dead.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No categorized COG for: {dead.join(", ")}.
                    </p>
                  ) : null
                })()}
              </>
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
