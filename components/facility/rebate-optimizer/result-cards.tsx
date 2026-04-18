"use client"

/**
 * Scenario Result Cards.
 *
 * Renders four headline stats for the active scenario:
 *   - Projected Rebate
 *   - Current Tier (and scenario-projected tier)
 *   - Gap-to-Next-Tier (spend needed)
 *   - Optimal Scenario (max additional rebate across evaluated scenarios)
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  ArrowUpRight,
  DollarSign,
  Layers,
  Sparkles,
  Target,
} from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer-engine"
import type { ScenarioEvaluation } from "./scenario-math"

interface ResultCardsProps {
  opportunity: RebateOpportunity | null
  /** Latest scenario evaluation (null when nothing submitted yet). */
  currentEvaluation: ScenarioEvaluation | null
  /** Across all scenarios the user has built, the one with the highest rebate delta. */
  optimalScenario: {
    label: string
    evaluation: ScenarioEvaluation
  } | null
}

export function ResultCards({
  opportunity,
  currentEvaluation,
  optimalScenario,
}: ResultCardsProps) {
  const projectedRebate = currentEvaluation?.projectedRebate ?? 0
  const rebateDelta = currentEvaluation?.rebateDelta ?? 0
  const currentTierNumber = opportunity?.currentTierNumber ?? null
  const scenarioTierNumber = currentEvaluation?.projectedTierNumber ?? null
  const gap = currentEvaluation?.gapToNextTier ?? opportunity?.spendNeeded ?? 0
  const reachesNextTier = currentEvaluation?.reachesNextTier ?? false

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Projected Rebate */}
      <Card className="border-l-4 border-l-emerald-500">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
            Projected Rebate
            <DollarSign className="h-4 w-4 text-emerald-500/60" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
            {formatCurrency(projectedRebate)}
          </p>
          {rebateDelta > 0 ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <ArrowUpRight className="h-3 w-3" />+{formatCurrency(rebateDelta)} vs current
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              No uplift yet — increase projected spend
            </p>
          )}
        </CardContent>
      </Card>

      {/* Current Tier */}
      <Card className="border-l-4 border-l-blue-500">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
            Current Tier
            <Layers className="h-4 w-4 text-blue-500/60" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {currentTierNumber !== null ? `Tier ${currentTierNumber}` : "Below Tier 1"}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
            {scenarioTierNumber !== null && scenarioTierNumber !== currentTierNumber ? (
              <Badge
                variant="outline"
                className="border-emerald-500/60 text-emerald-600 dark:text-emerald-400"
              >
                Scenario → Tier {scenarioTierNumber}
              </Badge>
            ) : (
              <span className="text-muted-foreground">
                Unchanged under current scenario
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Gap to Next Tier */}
      <Card className="border-l-4 border-l-amber-500">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
            Gap to Next Tier
            <Target className="h-4 w-4 text-amber-500/60" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">{formatCurrency(gap)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {reachesNextTier
              ? "Scenario reaches next tier"
              : opportunity
                ? `Next tier at ${formatCurrency(opportunity.nextTierThreshold)}`
                : "No active opportunity"}
          </p>
        </CardContent>
      </Card>

      {/* Optimal Scenario */}
      <Card className="border-l-4 border-l-purple-500">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between text-sm font-medium text-muted-foreground">
            Optimal Scenario
            <Sparkles className="h-4 w-4 text-purple-500/60" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {optimalScenario ? (
            <>
              <p
                className="truncate text-lg font-semibold"
                title={optimalScenario.label}
              >
                {optimalScenario.label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                +{formatCurrency(optimalScenario.evaluation.rebateDelta)} rebate uplift
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-muted-foreground">
                No scenarios yet
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Build at least one scenario to compare
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
