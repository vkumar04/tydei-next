"use client"

import type { ContractTerm, ContractTier } from "@/lib/generated/prisma/client"
import {
  formatCurrency,
  formatCalendarDate,
  formatPercent,
  formatNumber,
} from "@/lib/formatting"
import { formatRebateMethodLabel } from "@/lib/contracts/rebate-method-label"
import {
  formatTierRebateLabel,
  formatTierDollarAnnotation,
} from "@/lib/contracts/tier-rebate-label"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { DefinitionTooltip } from "@/components/shared/definition-tooltip"
import { calculateTierProgress } from "@/lib/contracts/tier-progress"
import {
  scaleRebateValueForEngine,
  type TierLike,
  type RebateMethodName,
} from "@/lib/rebates/calculate"
import {
  pickThresholdMetric,
  computeTierBarProgress,
} from "@/lib/contracts/tier-metric"

type ContractTermWithTiers = ContractTerm & { tiers: ContractTier[] }

interface ContractTermsDisplayProps {
  terms: ContractTermWithTiers[]
  currentSpend?: number
  /** Per-term scoped spend keyed by term.id. For `appliesTo = all_products`
   *  terms this matches `currentSpend`; for scoped terms it's the
   *  category-filtered slice computed server-side in getContract. Without
   *  it, both types of terms render identical tier projections (user bug
   *  2026-04-23). */
  termScopedSpend?: Record<string, number>
  /**
   * Contract-level qualification metrics, threaded through to the per-term
   * tier qualifier so market_share / compliance_rebate terms compare
   * against the right metric (not dollar spend). Bug Cluster B fix.
   */
  currentMarketShare?: number | null
  complianceRate?: number | null
}

function TierProgressCard({
  term,
  currentSpend,
  currentMarketShare,
  complianceRate,
}: {
  term: ContractTermWithTiers
  currentSpend: number
  currentMarketShare?: number | null
  complianceRate?: number | null
}) {
  if (term.tiers.length === 0) return null

  // 2026-07-29 math audit (CRITICAL). `ContractTier.rebateValue` is stored
  // as a FRACTION for percent_of_spend (0.10 = 10%), but every rebate engine
  // entry point takes INTEGER PERCENT and divides by 100 internally
  // (lib/rebates/engine/shared/cumulative.ts: `eligibleAmount * rebateValue / 100`).
  // Passing the raw fraction divided by 100 a second time, so every dollar
  // this card projected was 100x too small.
  //
  // Measured on the live Smith & Nephew ladder (T1 0-1,499,999 @ 0.10,
  // T2 1.5M-1,999,999 @ 0.15, T3 2M+ @ 0.20) at $806,162.47 contract spend:
  //   before  projectedAdditionalRebate = $1,443.84
  //   after                             = $144,383.75   (ratio exactly 100)
  // The engine's own unit contract is settled by tests/contracts/tier-progress.test.ts,
  // whose fixtures use 2 / 3 / 4 — integer percent.
  //
  // `scaleRebateValueForEngine` is the one helper that owns this conversion
  // (CLAUDE.md "Rebate units are per-rebateType"): it multiplies by 100 ONLY
  // for percent_of_spend and leaves fixed-dollar types alone, so a
  // $30,000 fixed_rebate tier does not become $3,000,000.
  const tiersForEngine: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax ? Number(t.spendMax) : null,
    rebateValue: scaleRebateValueForEngine(t.rebateValue, t.rebateType),
  }))
  const method = (term.rebateMethod ?? "cumulative") as RebateMethodName

  // Bug Cluster B fix: route market-share / compliance terms through the
  // contract-level metric instead of dollar spend. Without this, a
  // market-share term with tier.spendMin in market-share-percent units
  // (column-reuse pattern) gets qualified against dollar spend that is
  // orders of magnitude larger → engine picks the top tier on every
  // contract.
  const metric = pickThresholdMetric(term.termType, {
    currentSpend,
    currentMarketShare: currentMarketShare ?? null,
    complianceRate: complianceRate ?? null,
    currentVolume: null,
  })

  const progress = calculateTierProgress(metric, tiersForEngine, method)

  if (!progress.currentTier) return null

  const currentLabel =
    progress.currentTier.tierName ??
    `Tier ${progress.currentTier.tierNumber}`
  const nextLabel = progress.nextTier
    ? progress.nextTier.tierName ?? `Tier ${progress.nextTier.tierNumber}`
    : null

  // Pull the source Prisma tier (not the engine's pre-scaled view) so we
  // can route rate-label formatting through the canonical helper. The
  // progress calculator returns `rebateValue` as the raw fraction (0.03),
  // but different engines (cumulative vs marginal) historically handed it
  // back in different units — hand-rolling `* 100` here is how R5.22's
  // "Current: Tier 1 - 300.0%" bug creeps back in. Formatting via
  // `formatTierRebateLabel` also correctly handles non-percent tier
  // types (fixed/per-unit) as currency rather than as "%".
  const sourceTier = term.tiers.find(
    (t) => t.tierNumber === progress.currentTier!.tierNumber,
  )
  const rebateDisplay = sourceTier
    ? formatTierRebateLabel(sourceTier.rebateType, Number(sourceTier.rebateValue))
    : formatPercent(
        toDisplayRebateValue("percent_of_spend", progress.currentTier.rebateValue),
      )

  // Charles W1.W-B3: the progress bar's primary denominator is the
  // BASELINE — the spendMin of the first tier that starts earning a
  // rebate. When the facility is already past baseline, label the card
  // "Past baseline — N% to next tier" and use the next-tier threshold
  // as the denominator for the secondary bar. If tier 1 has
  // spendMin=$0 the baseline is trivially met.
  const sortedTiers = [...tiersForEngine].sort(
    (a, b) => Number(a.spendMin) - Number(b.spendMin),
  )
  const baselineSpend = Number(sortedTiers[0].spendMin)
  const pastBaseline = metric >= baselineSpend
  const baselinePercent =
    baselineSpend > 0
      ? Math.min(100, Math.max(0, (metric / baselineSpend) * 100))
      : 100

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          Current: {currentLabel} · {rebateDisplay}
        </span>
        {!pastBaseline ? (
          <span className="text-xs text-muted-foreground">
            {formatCurrency(Math.max(0, baselineSpend - metric))} to baseline
          </span>
        ) : nextLabel ? (
          <span className="text-xs text-muted-foreground">
            Past baseline · {formatCurrency(progress.amountToNextTier)} to {nextLabel}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Top tier achieved</span>
        )}
      </div>
      <Progress
        value={pastBaseline ? progress.progressPercent : baselinePercent}
        className="h-2"
      />
      {!pastBaseline ? (
        <div className="text-xs text-muted-foreground">
          {Math.round(baselinePercent)}% to baseline · no rebate earned until{" "}
          {formatCurrency(baselineSpend)}
        </div>
      ) : (
        progress.nextTier && progress.projectedAdditionalRebate > 0 && (
          <div className="text-xs text-muted-foreground">
            Projected additional rebate at {nextLabel}:{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(progress.projectedAdditionalRebate)}
            </span>
          </div>
        )
      )}
    </div>
  )
}

function TierDisplay({
  tier,
  currentSpend,
  currentMarketShare,
  currentTierNumber,
  isTopTier,
  rebateMethod = "cumulative",
  termIsScoped = false,
  isVolumeTerm = false,
  isMarketShareTerm = false,
}: {
  tier: ContractTier
  currentSpend?: number
  /** Bug A3 (bugs.rtfd 2026-06-11): the contract-level market-share %
   *  (0–100) — the metric `pickThresholdMetric` routes market_share
   *  terms through. The bar fill for market-share tiers must compare
   *  THIS against the percent thresholds, never `currentSpend` dollars
   *  (dollars dwarf 0–100, so every bar rendered fully achieved). */
  currentMarketShare?: number
  currentTierNumber?: number
  isTopTier?: boolean
  rebateMethod?: "cumulative" | "marginal"
  /** Bug 3 (2026-05-17): when true, render the tier threshold in
   *  UNITS (sourced from `volumeMin/volumeMax`) instead of dollars. */
  isVolumeTerm?: boolean
  /** Bug 2026-05-20 (Vick): when true, render the tier threshold as a
   *  market-share % (sourced from `marketShareMin/marketShareMax`)
   *  instead of dollar ranges. Falls back to spendMin/spendMax if the
   *  market-share fields aren't set on legacy rows. */
  isMarketShareTerm?: boolean
  /** True when the parent term is scoped to specific categories or SKUs.
   *  We suppress the dollar-projection annotation in that case because
   *  the only `currentSpend` we have is the contract-wide aggregate —
   *  projecting from it produces identical numbers across differently-
   *  scoped terms (e.g. all Arthrex Qualified Annual Spend shows the
   *  same projected dollars as the Distal Extremities Rebate sub-scope,
   *  which is wrong). Showing no annotation is more honest than showing
   *  misleading numbers. */
  termIsScoped?: boolean
}) {
  const rebateLabel = formatTierRebateLabel(
    tier.rebateType,
    Number(tier.rebateValue),
  )

  const spendMin = Number(tier.spendMin)
  const spendMax = tier.spendMax ? Number(tier.spendMax) : null

  // Market-share threshold fields: writers persist dedicated
  // marketShareMin/Max columns AND mirror them into spendMin/spendMax
  // (lib/actions/pending-contracts.ts column-reuse); legacy rows carry
  // the percent only in the mirror — so fall back, same as the range
  // label below.
  const msMin =
    tier.marketShareMin != null ? Number(tier.marketShareMin) : spendMin
  const msMax =
    tier.marketShareMax != null ? Number(tier.marketShareMax) : spendMax

  // Bug A3 (bugs.rtfd 2026-06-11): bar fill must compare the metric in
  // the tier's own unit. Market-share tiers store PERCENT (0–100)
  // thresholds; the old inline math compared dollar `currentSpend`
  // ($782,541) against them, so `spend >= spendMin` was always true and
  // every bar (0%+ / 50%+ / 100%+) rendered fully achieved at 71.1%
  // actual share. Both unit families now share the canonical
  // `computeTierBarProgress`; only the metric/threshold routing differs.
  const progress = isMarketShareTerm
    ? computeTierBarProgress({
        metric: currentMarketShare ?? 0,
        thresholdMin: msMin,
        thresholdMax: msMax,
      })
    : computeTierBarProgress({
        metric: currentSpend ?? 0,
        thresholdMin: spendMin,
        thresholdMax: spendMax,
      })

  // Charles W1.I: show dollar-amount context alongside the rate.
  // "$Y to unlock" / "earning $X at $spend" / non-percent unit suffix.
  //
  // When the term is scoped to specific categories or SKUs we skip the
  // dollar projection entirely — the only spend we have access to is
  // contract-wide, which produces misleadingly-identical numbers across
  // differently-scoped terms (user-reported bug 2026-04-23).
  const annotation =
    termIsScoped
      ? tier.rebateType !== "percent_of_spend"
        ? formatTierDollarAnnotation(
            {
              tierNumber: tier.tierNumber,
              spendMin: Number(tier.spendMin),
              spendMax: tier.spendMax ? Number(tier.spendMax) : null,
              rebateType: tier.rebateType,
              rebateValue: Number(tier.rebateValue),
            },
            0,
            -1,
            false,
            rebateMethod,
          )
        : null
      : currentSpend !== undefined && currentTierNumber !== undefined
      ? formatTierDollarAnnotation(
          {
            tierNumber: tier.tierNumber,
            spendMin: Number(tier.spendMin),
            spendMax: tier.spendMax ? Number(tier.spendMax) : null,
            rebateType: tier.rebateType,
            rebateValue: Number(tier.rebateValue),
          },
          currentSpend,
          currentTierNumber,
          Boolean(isTopTier && tier.tierNumber === currentTierNumber),
          rebateMethod,
        )
      : tier.rebateType !== "percent_of_spend"
        ? formatTierDollarAnnotation(
            {
              tierNumber: tier.tierNumber,
              spendMin: Number(tier.spendMin),
              spendMax: tier.spendMax ? Number(tier.spendMax) : null,
              rebateType: tier.rebateType,
              rebateValue: Number(tier.rebateValue),
            },
            0,
            -1,
            false,
            rebateMethod,
          )
        : null

  return (
    <div className="flex items-center gap-4 rounded-md border p-3">
      <Badge variant="outline" className="shrink-0">
        Tier {tier.tierNumber}
      </Badge>
      <div className="flex-1 space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {isVolumeTerm
              ? (() => {
                  const vMin =
                    tier.volumeMin != null
                      ? Number(tier.volumeMin)
                      : Number(tier.spendMin)
                  const vMax =
                    tier.volumeMax != null
                      ? Number(tier.volumeMax)
                      : tier.spendMax
                        ? Number(tier.spendMax)
                        : null
                  return vMax === null
                    ? `${formatNumber(vMin)}+ units`
                    : `${formatNumber(vMin)} – ${formatNumber(vMax)} units`
                })()
              : isMarketShareTerm
              ? // Same msMin/msMax (dedicated columns ?? spendMin/Max
                // mirror) that drives the bar fill above — one fallback,
                // no label-vs-bar drift (bugs.rtfd 2026-06-11 A3).
                msMax === null
                ? `${msMin.toFixed(1)}%+ market share`
                : `${msMin.toFixed(1)}% – ${msMax.toFixed(1)}% market share`
              : (
                <>
                  {formatCurrency(Number(tier.spendMin))}
                  {tier.spendMax ? ` - ${formatCurrency(Number(tier.spendMax))}` : "+"}
                </>
              )}
          </span>
          <span className="font-medium">{rebateLabel}</span>
        </div>
        {annotation && (
          <div className="text-xs text-muted-foreground" data-testid="tier-dollar-annotation">
            {annotation}
          </div>
        )}
        <Progress value={progress} className="h-1.5" />
      </div>
    </div>
  )
}

/**
 * Renders a chip row like `Categories: [Implants, Orthopedic, Spine]
 * (+3 more)`. Caps the visible chips at 8 so a 40-CPT scope doesn't
 * blow out the term card; surplus collapses into a `+N more` counter.
 */
function ScopeChipRow({ label, values }: { label: string; values: string[] }) {
  const MAX_VISIBLE = 8
  const visible = values.slice(0, MAX_VISIBLE)
  const remaining = values.length - visible.length
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}:</span>
      {visible.map((v) => (
        <Badge key={v} variant="outline" className="text-[10px] font-normal">
          {v}
        </Badge>
      ))}
      {remaining > 0 && (
        <span className="text-muted-foreground">+{remaining} more</span>
      )}
    </div>
  )
}

export function ContractTermsDisplay({ terms, currentSpend, termScopedSpend, currentMarketShare, complianceRate }: ContractTermsDisplayProps) {
  if (terms.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Terms & Tiers</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No terms defined</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Terms & Tiers</CardTitle>
      </CardHeader>
      <CardContent>
        <Accordion
          type="multiple"
          defaultValue={terms.map((t) => t.id)}
        >
          {terms.map((term) => (
            <AccordionItem key={term.id} value={term.id}>
              <AccordionTrigger>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{term.termName}</span>
                  <DefinitionTooltip term={term.termType}>
                    <Badge variant="secondary" className="capitalize">
                      {term.termType.replace(/_/g, " ")}
                    </Badge>
                  </DefinitionTooltip>
                  <Badge
                    variant={term.rebateMethod === "marginal" ? "default" : "outline"}
                    className="text-xs"
                  >
                    {formatRebateMethodLabel(term.rebateMethod)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatCalendarDate(term.effectiveStart)} -{" "}
                    {formatCalendarDate(term.effectiveEnd)}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  {/* Charles 2026-04-26 #75/#76, reworded for bugs.rtfd
                      2026-06-11 A5: the original banner claimed volume
                      terms NEED CPT codes ("the engine has nothing to
                      count") — stale since the COG-quantity fallback
                      shipped (bug #17 + 2026-06-10 commit 59333750):
                      with no CPT codes the engine sums line-item
                      quantity from the contract vendors' COG records and
                      still accrues. Keep the banner informational (CPT
                      codes switch the basis to Case Costing procedure
                      counts), and skip it for purchase_order-basis
                      terms, which count POs and never use CPT codes. */}
                  {(term.termType === "volume_rebate" ||
                    term.termType === "rebate_per_use" ||
                    term.termType === "capitated_pricing_rebate") &&
                    (!term.cptCodes || term.cptCodes.length === 0) &&
                    term.volumeType !== "purchase_order" && (
                      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                        <p className="font-semibold">
                          No CPT codes configured — volume is counted from
                          COG line-item quantity instead.
                        </p>
                        <p className="mt-1">
                          Without CPT codes, {term.termType.replace(/_/g, " ")}{" "}
                          terms sum the quantity on this contract&apos;s
                          vendor COG records within the term&apos;s scope.
                          To count procedure occurrences from Case Costing
                          instead, edit the contract and add CPT codes to
                          this term, then click <em>Recompute Earned
                          Rebates</em> on the Transactions tab.
                        </p>
                      </div>
                    )}
                  {/* Charles 2026-04-26 #55: same banner pattern for
                      carve-out terms. The engine reads the per-line
                      carveOutPercent from ContractPricing rows; if the
                      pricing file didn't carry that column, every line
                      gets a 0% rate and the term computes nothing. */}
                  {term.termType === "carve_out" && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                      <p className="font-semibold">
                        Carve-out engine reads per-line rates from pricing.
                      </p>
                      <p className="mt-1">
                        For each carved-out SKU, the engine applies the
                        <code className="mx-1">carveOutPercent</code>
                        column on the contract&apos;s pricing rows. If
                        your uploaded pricing file lacks that column,
                        edit each pricing row to set the percent — then
                        click <em>Recompute Earned Rebates</em>. The toast
                        will name carve-out terms that still have no
                        per-line rates configured.
                      </p>
                    </div>
                  )}
                  {/* Bug 2026-05-18 (Vick "categories not here"): the
                      Rebates & Tiers tab previously only surfaced
                      Baseline / Spend Baseline / Evaluation. The user
                      reads this section to audit *what the rebate
                      applies to* — so include Product Scope, Categories,
                      REF#s, CPTs, Volume Counted By, baselines, and
                      Payment Timing here too. Empty fields collapse so
                      a simple `all_products` term still reads clean. */}
                  <div className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                    <div>
                      <DefinitionTooltip term="baseline_type">
                        <span className="text-muted-foreground">Baseline</span>
                      </DefinitionTooltip>
                      <span className="text-muted-foreground">: </span>
                      <span className="capitalize">
                        {term.baselineType.replace("_", " ")}
                      </span>
                    </div>
                    <div>
                      <DefinitionTooltip term="evaluation_period">
                        <span className="text-muted-foreground">Evaluation</span>
                      </DefinitionTooltip>
                      <span className="text-muted-foreground">: </span>
                      <span className="capitalize">
                        {term.evaluationPeriod}
                      </span>
                    </div>
                    {/* Bug 5 (Vick 2026-06-02): Payment Timing removed — it
                        duplicated Evaluation Period and isn't engine-wired. */}
                    <div>
                      <span className="text-muted-foreground">Scope: </span>
                      <span className="capitalize">
                        {term.appliesTo.replace("_", " ")}
                      </span>
                    </div>
                    {term.spendBaseline && (
                      <div>
                        <span className="text-muted-foreground">
                          Spend Baseline:{" "}
                        </span>
                        {formatCurrency(Number(term.spendBaseline))}
                      </div>
                    )}
                    {term.volumeBaseline != null && (
                      <div>
                        <span className="text-muted-foreground">
                          Volume Baseline:{" "}
                        </span>
                        {formatNumber(term.volumeBaseline)} units
                      </div>
                    )}
                    {term.termType === "volume_rebate" && term.volumeType && (
                      <div>
                        <span className="text-muted-foreground">
                          Volume Counted By:{" "}
                        </span>
                        <span className="capitalize">
                          {term.volumeType.replace(/_/g, " ")}
                        </span>
                      </div>
                    )}
                  </div>
                  {((term.categories?.length ?? 0) > 0 ||
                    (term.referenceNumbers?.length ?? 0) > 0 ||
                    (term.cptCodes?.length ?? 0) > 0) && (
                    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2.5 text-xs">
                      {term.categories.length > 0 && (
                        <ScopeChipRow
                          label="Categories"
                          values={term.categories}
                        />
                      )}
                      {term.referenceNumbers.length > 0 && (
                        <ScopeChipRow
                          label="REF Numbers"
                          values={term.referenceNumbers}
                        />
                      )}
                      {term.cptCodes.length > 0 && (
                        <ScopeChipRow
                          label="CPT Codes"
                          values={term.cptCodes}
                        />
                      )}
                    </div>
                  )}
                  {(() => {
                    // Pick the spend that actually applies to THIS term:
                    // scoped spend when the term is category-scoped and
                    // the server provided a value, otherwise the contract-
                    // wide aggregate (correct for all_products terms).
                    const effectiveSpend =
                      termScopedSpend?.[term.id] !== undefined
                        ? termScopedSpend[term.id]
                        : currentSpend
                    const usingScopedSpend =
                      term.appliesTo !== "all_products" &&
                      termScopedSpend?.[term.id] !== undefined
                    if (effectiveSpend === undefined || term.tiers.length === 0) {
                      return null
                    }
                    // Bug 2026-05-25 (Vick): carve_out terms render "Tier 1 /
                    // Tier 2 / Tier 3 · 18.9% top rate" even when the user
                    // entered no tiers. The engine doesn't use the tier
                    // ladder for carve_out (per the amber warning banner
                    // above — "engine reads per-line rates from pricing"),
                    // so showing the tier ladder is just visual noise that
                    // contradicts the warning. Carve-out terms may still
                    // carry phantom tier rows from AI extraction or default
                    // form scaffolds; suppress the ladder UI for them and
                    // let the Pricing tab show the per-line percents.
                    if (term.termType === "carve_out") {
                      return null
                    }
                    return (
                      <>
                        <TierProgressCard
                          term={term}
                          currentSpend={effectiveSpend}
                          currentMarketShare={currentMarketShare}
                          complianceRate={complianceRate}
                        />
                        {usingScopedSpend && (
                          <p className="text-[11px] italic text-muted-foreground">
                            Scoped to this term's product categories — not the
                            full contract spend.
                          </p>
                        )}
                        {(() => {
                          const sorted = [...term.tiers].sort(
                            (a, b) => Number(a.spendMin) - Number(b.spendMin),
                          )
                          // 0 = "below baseline" sentinel — spend hasn't
                          // reached even the lowest tier's spendMin. The
                          // annotation logic in `formatTierDollarAnnotation`
                          // (lib/contracts/tier-rebate-label.ts:91) treats
                          // this as "to unlock" and correctly suppresses the
                          // top-rate projection. Pre-fix this defaulted to
                          // sorted[0].tierNumber, so a scoped term with
                          // current spend ($302k) below tier 1's floor
                          // ($825k) was rendered as "top rate — projects 2%
                          // of $302k = $6,053", a phantom rebate that doesn't
                          // exist (Bug #3).
                          const tierMetric = pickThresholdMetric(term.termType, {
                            currentSpend: effectiveSpend,
                            currentMarketShare: currentMarketShare ?? null,
                            complianceRate: complianceRate ?? null,
                            currentVolume: null,
                          })
                          let currentTierNumber = 0
                          for (let i = 0; i < sorted.length; i++) {
                            if (tierMetric >= Number(sorted[i].spendMin)) {
                              currentTierNumber = sorted[i].tierNumber
                            }
                          }
                          const topTierNumber = sorted[sorted.length - 1].tierNumber
                          const isTopTierReached =
                            currentTierNumber > 0 &&
                            currentTierNumber === topTierNumber
                          return (
                            <div className="space-y-2">
                              {term.tiers.map((tier) => (
                                <TierDisplay
                                  key={tier.id}
                                  tier={tier}
                                  currentSpend={effectiveSpend}
                                  // Bug A3 (bugs.rtfd 2026-06-11): the
                                  // same metric pickThresholdMetric
                                  // routes market_share terms through —
                                  // bar fill needs percent vs percent,
                                  // not dollars vs percent.
                                  currentMarketShare={currentMarketShare ?? undefined}
                                  currentTierNumber={currentTierNumber}
                                  isTopTier={isTopTierReached}
                                  rebateMethod={(term.rebateMethod ?? "cumulative") as "cumulative" | "marginal"}
                                  // Now that the scoped spend is correct,
                                  // the annotation can render honest numbers.
                                  termIsScoped={false}
                                  isVolumeTerm={term.termType === "volume_rebate"}
                                  isMarketShareTerm={term.termType === "market_share"}
                                />
                              ))}
                            </div>
                          )
                        })()}
                      </>
                    )
                  })()}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </CardContent>
    </Card>
  )
}
