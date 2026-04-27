"use client"

import {
  HelpCircle,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { getContract } from "@/lib/actions/contracts"
import type { TierProgressResult } from "@/lib/contracts/tier-progress"
import type { ProjectedRebateResult } from "@/lib/contracts/projected-rebate"
import { formatCurrency, formatCalendarDate, formatPercent } from "@/lib/formatting"
import { formatTierRebateLabel } from "@/lib/contracts/tier-rebate-label"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { ContractTieInCard } from "@/components/contracts/contract-tie-in-card"
import { ContractBundleMembershipsCard } from "@/components/contracts/contract-bundle-memberships-card"
import { ContractPerformanceCard } from "@/components/contracts/contract-performance-card"
import { ContractCapitalProjectionCard } from "@/components/contracts/contract-capital-projection-card"
import { ContractAmortizationCard } from "@/components/contracts/contract-amortization-card"
import { OffContractSpendCard } from "@/components/contracts/off-contract-spend-card"
import { CategoryMarketShareCard } from "@/components/contracts/category-market-share-card"
import { ContractChangeProposalsCard } from "@/components/contracts/contract-change-proposals-card"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { TabsContent } from "@/components/ui/tabs"

type ContractData = NonNullable<Awaited<ReturnType<typeof getContract>>>

/**
 * The shape returned by the `stats` useMemo in ContractDetailClient.
 * Typed explicitly here so OverviewTabProps can reference it without
 * importing the parent's internal useMemo logic.
 */
export interface ContractStats {
  totalValue: number
  totalSpend: number
  commitmentPct: number
  rebateEarned: number
  rebateEarnedYTD: number
  rebateCollected: number
  daysUntilExpiration: number
  expirationDate: ContractData["expirationDate"]
  tierProgress: TierProgressResult | null
  currentTierSourceTier: ContractData["terms"][number]["tiers"][number] | null
  atTopTier: boolean
  hasTiers: boolean
  projectedYearEnd: ProjectedRebateResult | null
}

export interface OverviewTabProps {
  /** The (non-null) contract data fetched by useContract in the parent. */
  contract: ContractData
  /** contractId string prop (matches ContractDetailClientProps.contractId). */
  contractId: string
  /**
   * Pre-computed stats object from the parent's useMemo. Null only when
   * contract is null — callers must guard before rendering OverviewTab.
   */
  stats: ContractStats | null
  /**
   * Deduped, ordered list of product categories: primary first, then
   * remaining join-table categories alphabetically.
   */
  productCategories: Array<{ id: string; name: string }>
}

export function OverviewTab({
  contract,
  contractId,
  stats,
  productCategories,
}: OverviewTabProps) {
  return (
    <TabsContent value="overview" className="mt-6 space-y-6">
      {/* Pending vendor-submitted change proposals — hidden when none. */}
      <ContractChangeProposalsCard contractId={contractId} />
      {/* Tie-in bundle card — renders only when this contract is a bundle primary */}
      <ContractTieInCard contractId={contractId} />
      {/* v0 bundled-multi-product tie-in memberships card. */}
      <ContractBundleMembershipsCard contractId={contractId} />
      {/* Performance card — rebate utilization, market share, renewal risk. */}
      <ContractPerformanceCard
        contractId={contractId}
        vendorId={contract.vendorId}
        productCategory={contract.productCategory?.name ?? null}
      />
      {/* Wave A: tie-in amortization + capital summary.
          Shows only for tie-in contracts that either link to a capital
          contract or carry capital fields on a term themselves. */}
      {contract.contractType === "tie_in" && (
        // Charles audit suggestion #4 (v0-port): always render — the
        // card itself shows an empty state when no capital line
        // items exist (the legacy capitalCost null-check was here).
        <ContractAmortizationCard contractId={contractId} />
      )}
      {/* Wave C — shortfall handling banner + run-rate projection
          (only for tie-in contracts). */}
      {contract.contractType === "tie_in" &&
        (() => {
          const tieInTerm = contract.terms.find(
            (t) => t.shortfallHandling != null,
          )
          const handling = tieInTerm?.shortfallHandling ?? "carry_forward"
          const billImmediately = handling === "bill_immediately"
          return (
            <div
              className={
                "rounded-md border p-3 text-sm " +
                (billImmediately
                  ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                  : "border-muted bg-muted/30 text-muted-foreground")
              }
            >
              <span className="font-medium">
                {billImmediately ? "⚠ Shortfall handling: " : "ℹ Shortfall handling: "}
              </span>
              {billImmediately
                ? "Bill immediately — vendor invoices the shortfall at period close."
                : "Carry forward — the shortfall applies to the next period's commitment."}
            </div>
          )
        })()}
      {contract.contractType === "tie_in" && (
        <ContractCapitalProjectionCard contractId={contractId} />
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Contract Details Card */}
        <Card>
          <CardHeader>
            <CardTitle>Contract Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow
              label="Contract Type"
              value={
                <span className="capitalize">
                  {contract.contractType.replace(/_/g, " ")}
                </span>
              }
            />
            {productCategories.length > 0 && (
              <DetailRow
                label={
                  productCategories.length > 1
                    ? "Product Categories"
                    : "Product Category"
                }
                value={
                  productCategories.length > 3 ? (
                    <div className="flex flex-wrap justify-end gap-1">
                      {productCategories.map((pc) => (
                        <Badge key={pc.id} variant="secondary">
                          {pc.name}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    productCategories.map((pc) => pc.name).join(", ")
                  )
                }
              />
            )}
            <DetailRow
              label="Effective Date"
              value={formatCalendarDate(contract.effectiveDate)}
            />
            <DetailRow
              label="Expiration Date"
              value={formatCalendarDate(contract.expirationDate)}
            />
            <DetailRow label="Vendor" value={contract.vendor.name} />
            {contract.description && (
              <div className="pt-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Description
                </p>
                <p className="mt-1 text-sm">{contract.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Commitment Progress Card */}
        <Card>
          <CardHeader>
            <CardTitle>Commitment Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {stats && (
              <>
                {stats.hasTiers &&
                  stats.tierProgress &&
                  stats.tierProgress.currentTier && (
                    <div className="space-y-2">
                      {(() => {
                        const tp = stats.tierProgress!
                        const currentTier = tp.currentTier!
                        const nextTier = tp.nextTier
                        const atTop = stats.atTopTier
                        const currentLabel =
                          currentTier.tierName ??
                          `Tier ${currentTier.tierNumber}`
                        const nextLabel = nextTier
                          ? nextTier.tierName ??
                            `Tier ${nextTier.tierNumber}`
                          : null
                        const rateDisplay = stats.currentTierSourceTier
                          ? formatTierRebateLabel(
                              stats.currentTierSourceTier.rebateType,
                              Number(
                                stats.currentTierSourceTier.rebateValue,
                              ),
                            )
                          : formatPercent(
                              toDisplayRebateValue(
                                "percent_of_spend",
                                currentTier.rebateValue,
                              ),
                            )
                        // Charles W1.W-B3: bar denominator is BASELINE —
                        // the first tier threshold that starts earning a
                        // rebate. Past baseline, flip to "Past baseline ·
                        // N% to next tier" and use the next-tier threshold
                        // for the secondary bar. Contract Value is still
                        // a separate metric on the header card.
                        const firstTermWithTiers = contract.terms?.find(
                          (t) => t.tiers.length > 0,
                        )
                        const sortedTiers = firstTermWithTiers
                          ? [...firstTermWithTiers.tiers].sort(
                              (a, b) =>
                                Number(a.spendMin) - Number(b.spendMin),
                            )
                          : []
                        const baselineSpend = sortedTiers.length
                          ? Number(sortedTiers[0].spendMin)
                          : 0
                        const pastBaseline =
                          stats.totalSpend >= baselineSpend
                        const baselinePercent = baselineSpend > 0
                          ? Math.min(
                              100,
                              Math.max(
                                0,
                                (stats.totalSpend / baselineSpend) * 100,
                              ),
                            )
                          : 100
                        const barPct = !pastBaseline
                          ? Math.round(baselinePercent)
                          : atTop
                            ? 100
                            : Math.round(tp.progressPercent)
                        const nextThreshold = nextTier?.spendMin ?? 0
                        return (
                          <>
                            <div className="flex items-center justify-between text-sm">
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                {!pastBaseline
                                  ? "Spend Progress to Baseline"
                                  : atTop
                                    ? "Past baseline · Top Tier Achieved"
                                    : `Past baseline · ${Math.round(tp.progressPercent)}% to ${nextLabel}`}
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex cursor-help items-center">
                                        <HelpCircle
                                          className="h-3.5 w-3.5 text-muted-foreground"
                                          aria-label="Spend Progress help"
                                        />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[320px] p-3 text-xs">
                                      <p>
                                        Progress toward the BASELINE — the
                                        first tier threshold that starts
                                        earning a rebate. Once baseline is
                                        met the bar flips to measure
                                        progress toward the next tier.
                                        Contract Value is a separate
                                        metric shown on the header card.
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </span>
                              <span className="font-medium">{barPct}%</span>
                            </div>
                            <Progress
                              value={barPct}
                              className={
                                atTop
                                  ? "h-2 opacity-60"
                                  : "h-2"
                              }
                            />
                            {!pastBaseline ? (
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(stats.totalSpend)} of{" "}
                                {formatCurrency(baselineSpend)} to unlock
                                the first rebate tier ({currentLabel})
                              </p>
                            ) : atTop ? (
                              <p className="text-xs text-muted-foreground">
                                {currentLabel} rebate rate: {rateDisplay}.
                                Keep spending to maximize rebate.
                              </p>
                            ) : (
                              <>
                                <p className="text-xs text-muted-foreground">
                                  {formatCurrency(stats.totalSpend)} of{" "}
                                  {formatCurrency(nextThreshold)} to unlock{" "}
                                  {nextLabel}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Currently {currentLabel} · {rateDisplay}{" "}
                                  rebate
                                </p>
                              </>
                            )}
                            {(() => {
                              const term = contract.terms?.[0]
                              const mpc =
                                term?.minimumPurchaseCommitment != null
                                  ? Number(term.minimumPurchaseCommitment)
                                  : null
                              if (mpc == null || mpc <= 0) return null
                              // Charles audit suggestion #4 (v0-port):
                              // paymentCadence moved to capital line items.
                              // Default monthly — minimum-purchase-commitment
                              // is term-period-scoped, not cadence-scoped, so
                              // monthly is a safe display default until the
                              // term-level cadence accessor is wired.
                              const cadence: "monthly" | "quarterly" | "annual" =
                                "monthly" as "monthly" | "quarterly" | "annual"
                              const cadenceLabel =
                                cadence === "quarterly"
                                  ? "Quarterly"
                                  : cadence === "annual"
                                    ? "Annual"
                                    : "Monthly"
                              const perPeriods =
                                cadence === "quarterly"
                                  ? 4
                                  : cadence === "annual"
                                    ? 1
                                    : 12
                              const perPeriod = mpc / perPeriods
                              return (
                                <p className="text-xs text-muted-foreground">
                                  Minimum {cadenceLabel} Purchase:{" "}
                                  <span className="font-medium">
                                    {formatCurrency(perPeriod)}
                                  </span>{" "}
                                  ({formatCurrency(mpc)}/yr)
                                </p>
                              )
                            })()}
                          </>
                        )
                      })()}
                    </div>
                  )}
                {!stats.hasTiers &&
                  contract.contractType !== "pricing_only" && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          Spend Progress
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-help items-center">
                                  <HelpCircle
                                    className="h-3.5 w-3.5 text-muted-foreground"
                                    aria-label="Spend Progress help"
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[320px] p-3 text-xs">
                                <p>
                                  This contract has no rebate tiers
                                  configured yet, so progress is shown
                                  against the Contract Value field on the
                                  agreement. Add tiers under Terms to see
                                  progress toward the next rebate
                                  threshold.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </span>
                        <span className="font-medium">
                          {stats.commitmentPct}%
                        </span>
                      </div>
                      <Progress
                        value={Math.min(stats.commitmentPct, 100)}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(stats.totalSpend)} of{" "}
                        {formatCurrency(stats.totalValue)} Contract Value
                      </p>
                    </div>
                  )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      Rebate Collection
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center">
                              <HelpCircle
                                className="h-3.5 w-3.5 text-muted-foreground"
                                aria-label="Rebate Collection help"
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[320px] p-3 text-xs">
                            <p>
                              Rebate dollars collected divided by rebate
                              dollars earned (lifetime). Earned sums
                              Rebate rows whose pay period has closed;
                              Collected sums rows with a collection date
                              recorded. No tier-engine projections.
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </span>
                    <span className="font-medium">
                      {stats.rebateEarned > 0
                        ? Math.round(
                            (stats.rebateCollected / stats.rebateEarned) *
                              100,
                          )
                        : 0}
                      %
                    </span>
                  </div>
                  <Progress
                    value={
                      stats.rebateEarned > 0
                        ? Math.min(
                            Math.round(
                              (stats.rebateCollected /
                                stats.rebateEarned) *
                                100,
                            ),
                            100,
                          )
                        : 0
                    }
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(stats.rebateCollected)} of{" "}
                    {formatCurrency(stats.rebateEarned)} earned
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charles audit suggestion #4 (v0-port): the legacy
          contract-level Tie-In Capital card was removed — capital
          now lives in ContractCapitalLineItem rows and is rendered
          by <ContractAmortizationCard> below as a v0-style item
          table + aggregated schedule. */}

      {/* Compliance Status Card */}
      {contract.complianceRate != null && (
        <Card>
          <CardHeader>
            <CardTitle>Compliance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold">
                {Number(contract.complianceRate).toFixed(0)}%
              </div>
              <Badge
                className={
                  Number(contract.complianceRate) >= 90
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : Number(contract.complianceRate) >= 75
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-red-500/15 text-red-700 dark:text-red-400"
                }
              >
                {Number(contract.complianceRate) >= 90
                  ? "On Track"
                  : Number(contract.complianceRate) >= 75
                    ? "Needs Attention"
                    : "At Risk"}
              </Badge>
            </div>
            <Progress value={Number(contract.complianceRate)} />
            <p className="text-xs text-muted-foreground">
              % of vendor purchases routed through this contract.
            </p>
          </CardContent>
        </Card>
      )}

      {/*
       * Charles 2026-04-25: per-category market share. Computes
       * the vendor's share of facility spend in each category
       * they sell in, from real COG data (no schema migration
       * required). Renders only on contracts whose vendor has
       * COG presence.
       */}
      <CategoryMarketShareCard
        vendorId={contract.vendorId}
        contractId={contractId}
      />

      {contract.currentMarketShare != null && contract.marketShareCommitment != null && Number(contract.marketShareCommitment) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Market Share Commitment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="text-3xl font-bold">
                {Number(contract.currentMarketShare).toFixed(0)}%
              </div>
              <span className="text-sm text-muted-foreground">
                of {Number(contract.marketShareCommitment).toFixed(0)}% commitment
              </span>
              <Badge
                className={
                  (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100 >= 80
                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                    : (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100 >= 60
                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                      : "bg-red-500/15 text-red-700 dark:text-red-400"
                }
              >
                {Math.round(
                  (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100,
                )}% met
              </Badge>
            </div>
            <Progress
              value={Math.min(
                100,
                (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100,
              )}
            />
            <p className="text-xs text-muted-foreground">
              Current market share vs the commitment target on this contract.
            </p>
          </CardContent>
        </Card>
      )}

      <OffContractSpendCard contractId={contractId} />
    </TabsContent>
  )
}

/* ── Helper Components ──────────────────────────────────────────── */

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
