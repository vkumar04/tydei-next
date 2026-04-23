"use client"

import type { ContractTerm, ContractTier } from "@prisma/client"
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting"
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
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"

type ContractTermWithTiers = ContractTerm & { tiers: ContractTier[] }

interface ContractTermsDisplayProps {
  terms: ContractTermWithTiers[]
  currentSpend?: number
}

function TierProgressCard({
  term,
  currentSpend,
}: {
  term: ContractTermWithTiers
  currentSpend: number
}) {
  if (term.tiers.length === 0) return null

  const tiersForEngine: TierLike[] = term.tiers.map((t) => ({
    tierNumber: t.tierNumber,
    tierName: t.tierName ?? null,
    spendMin: Number(t.spendMin),
    spendMax: t.spendMax ? Number(t.spendMax) : null,
    rebateValue: Number(t.rebateValue),
  }))
  const method = (term.rebateMethod ?? "cumulative") as RebateMethodName

  const progress = calculateTierProgress(currentSpend, tiersForEngine, method)

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
  const pastBaseline = currentSpend >= baselineSpend
  const baselinePercent =
    baselineSpend > 0
      ? Math.min(100, Math.max(0, (currentSpend / baselineSpend) * 100))
      : 100

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          Current: {currentLabel} · {rebateDisplay}
        </span>
        {!pastBaseline ? (
          <span className="text-xs text-muted-foreground">
            {formatCurrency(Math.max(0, baselineSpend - currentSpend))} to baseline
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
  currentTierNumber,
  isTopTier,
}: {
  tier: ContractTier
  currentSpend?: number
  currentTierNumber?: number
  isTopTier?: boolean
}) {
  const rebateLabel = formatTierRebateLabel(
    tier.rebateType,
    Number(tier.rebateValue),
  )

  const spendMin = Number(tier.spendMin)
  const spendMax = tier.spendMax ? Number(tier.spendMax) : null
  const spend = currentSpend ?? 0

  let progress = 0
  if (spend >= spendMin && spendMax && spend < spendMax) {
    progress = ((spend - spendMin) / (spendMax - spendMin)) * 100
  } else if (spend >= spendMin && !spendMax) {
    progress = 100
  } else if (spendMax && spend >= spendMax) {
    progress = 100
  }

  // Charles W1.I: show dollar-amount context alongside the rate.
  // "$Y to unlock" / "earning $X at $spend" / non-percent unit suffix.
  const annotation =
    currentSpend !== undefined && currentTierNumber !== undefined
      ? formatTierDollarAnnotation(
          {
            tierNumber: tier.tierNumber,
            spendMin: Number(tier.spendMin),
            rebateType: tier.rebateType,
            rebateValue: Number(tier.rebateValue),
          },
          currentSpend,
          currentTierNumber,
          Boolean(isTopTier && tier.tierNumber === currentTierNumber),
        )
      : tier.rebateType !== "percent_of_spend"
        ? formatTierDollarAnnotation(
            {
              tierNumber: tier.tierNumber,
              spendMin: Number(tier.spendMin),
              rebateType: tier.rebateType,
              rebateValue: Number(tier.rebateValue),
            },
            0,
            -1,
            false,
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
            {formatCurrency(Number(tier.spendMin))}
            {tier.spendMax ? ` - ${formatCurrency(Number(tier.spendMax))}` : "+"}
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

export function ContractTermsDisplay({ terms, currentSpend }: ContractTermsDisplayProps) {
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
                    {term.rebateMethod === "marginal"
                      ? "Growth (Marginal)"
                      : "Dollar 1 (Cumulative)"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(term.effectiveStart)} -{" "}
                    {formatDate(term.effectiveEnd)}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-3 pt-2">
                  <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <div>
                      <DefinitionTooltip term="baseline_type">
                        <span className="text-muted-foreground">Baseline</span>
                      </DefinitionTooltip>
                      <span className="text-muted-foreground">: </span>
                      <span className="capitalize">
                        {term.baselineType.replace("_", " ")}
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
                    <div>
                      <DefinitionTooltip term="evaluation_period">
                        <span className="text-muted-foreground">Evaluation</span>
                      </DefinitionTooltip>
                      <span className="text-muted-foreground">: </span>
                      <span className="capitalize">
                        {term.evaluationPeriod}
                      </span>
                    </div>
                  </div>
                  {currentSpend !== undefined && term.tiers.length > 0 && (
                    <TierProgressCard term={term} currentSpend={currentSpend} />
                  )}
                  {term.tiers.length > 0 && (() => {
                    // Determine the highest tier whose spendMin is met, so
                    // each tier row can render its dollar-amount annotation
                    // (earning/unlock/would-earn) relative to current spend.
                    const sorted = [...term.tiers].sort(
                      (a, b) => Number(a.spendMin) - Number(b.spendMin),
                    )
                    let currentTierNumber: number | undefined
                    if (currentSpend !== undefined) {
                      let idx = 0
                      for (let i = 0; i < sorted.length; i++) {
                        if (currentSpend >= Number(sorted[i].spendMin)) idx = i
                      }
                      currentTierNumber = sorted[idx].tierNumber
                    }
                    const topTierNumber = sorted[sorted.length - 1].tierNumber
                    const isTopTierReached =
                      currentTierNumber !== undefined &&
                      currentTierNumber === topTierNumber
                    return (
                      <div className="space-y-2">
                        {term.tiers.map((tier) => (
                          <TierDisplay
                            key={tier.id}
                            tier={tier}
                            currentSpend={currentSpend}
                            currentTierNumber={currentTierNumber}
                            isTopTier={isTopTierReached}
                          />
                        ))}
                      </div>
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
