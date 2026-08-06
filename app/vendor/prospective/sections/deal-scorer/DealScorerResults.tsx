"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, TrendingUp, Sparkles, DollarSign } from "lucide-react"

import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { VendorProspectiveAnalysisResult } from "@/lib/actions/vendor-prospective"
import type { VendorProspectiveResult } from "@/lib/prospective-analysis/vendor-prospective-analyzer"
import { DealScoreLegend } from "@/components/vendor/prospective/deal-score-view"

// ─── Results ───────────────────────────────────────────────────

export function ResultsView({ result }: { result: VendorProspectiveAnalysisResult }) {
  // Audit M6: no caller supplies a proposedRebateConfig today, so the
  // tier-optimization result is the "No tiered rebate config supplied"
  // sentinel (all three numeric fields null). Hide the card rather than
  // render a permanently-dead "Achieved tier: none" panel.
  const t = result.tierOptimization
  const hasTierAnalysis =
    t.achievedTier != null ||
    t.distanceToNextTier != null ||
    t.additionalRebateAtNextTier != null

  return (
    <div className="space-y-4">
      {/* Wave-3 F: the weighted deal score + "what moves it" legend (incl.
          the amber 55%-GM-assumed flag) leads the results. */}
      <DealScoreLegend breakdown={result.dealScore} />

      {result.warnings.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="flex gap-3 py-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <ul className="space-y-1 text-sm">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <ScenarioTable result={result} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PenetrationCard result={result} />
        {hasTierAnalysis && <TierOptimizationCard result={result} />}
      </div>

      {result.capitalAnalysis && <CapitalCard result={result} />}
    </div>
  )
}

function ScenarioTable({ result }: { result: VendorProspectiveResult }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Scenario margin analysis</CardTitle>
        <CardDescription>
          Recommended scenario:{" "}
          {result.recommendedScenario ? (
            <span className="font-semibold">
              {result.recommendedScenario.scenarioName} —{" "}
              {formatPercent(result.recommendedScenario.grossMarginPercent * 100)} margin
            </span>
          ) : (
            <span className="text-red-600">none meet floor</span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-2 font-medium">Scenario</th>
                <th className="p-2 font-medium">Unit price</th>
                <th className="p-2 font-medium">Annual revenue</th>
                <th className="p-2 font-medium">Rebate paid</th>
                <th className="p-2 font-medium">Net revenue</th>
                <th className="p-2 font-medium">Gross margin</th>
                <th className="p-2 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {result.scenarioResults.map((s) => {
                const isRecommended =
                  result.recommendedScenario?.scenarioName === s.scenarioName
                return (
                  <tr
                    key={s.scenarioName}
                    className={
                      isRecommended
                        ? "border-t bg-emerald-50/50 dark:bg-emerald-950/20"
                        : "border-t"
                    }
                  >
                    <td className="p-2 font-medium">
                      {s.scenarioName}
                      {isRecommended && (
                        <Sparkles className="ml-1 inline h-3 w-3 text-emerald-600" />
                      )}
                    </td>
                    <td className="p-2">{formatCurrency(s.unitPrice)}</td>
                    <td className="p-2">{formatCurrency(s.annualRevenue)}</td>
                    <td className="p-2">{formatCurrency(s.annualRebatePaid)}</td>
                    <td className="p-2">{formatCurrency(s.netRevenue)}</td>
                    <td className="p-2">
                      {formatPercent(s.grossMarginPercent * 100)}
                    </td>
                    <td className="p-2">
                      {!s.meetsFloorMargin ? (
                        <Badge variant="destructive">below floor</Badge>
                      ) : s.meetsTargetMargin ? (
                        <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                          meets target
                        </Badge>
                      ) : (
                        <Badge variant="secondary">above floor</Badge>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function PenetrationCard({ result }: { result: VendorProspectiveResult }) {
  const p = result.penetrationAnalysis
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4" />
          Penetration & revenue at risk
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row label="Current share" value={formatPercent(p.currentShare * 100)} />
        <Row label="Target share" value={formatPercent(p.targetShare * 100)} />
        <Row
          label="Current revenue"
          value={formatCurrency(p.currentAnnualRevenue)}
        />
        <Row
          label="Target revenue"
          value={formatCurrency(p.targetAnnualRevenue)}
        />
        <Row
          label="Incremental opportunity"
          value={formatCurrency(p.incrementalRevenueOpportunity)}
          emphasis
        />
        <Row
          label="Revenue at risk"
          value={formatCurrency(result.revenueAtRisk)}
          emphasis
        />
      </CardContent>
    </Card>
  )
}

function TierOptimizationCard({ result }: { result: VendorProspectiveResult }) {
  const t = result.tierOptimization
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          Tier optimization
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row
          label="Achieved tier"
          value={
            t.achievedTier
              ? (t.achievedTier.tierName ?? `Tier ${t.achievedTier.tierNumber}`)
              : "none"
          }
        />
        {t.distanceToNextTier != null && (
          <Row
            label="Distance to next"
            value={formatCurrency(t.distanceToNextTier)}
          />
        )}
        {t.additionalRebateAtNextTier != null && (
          <Row
            label="Additional rebate at next"
            value={formatCurrency(t.additionalRebateAtNextTier)}
          />
        )}
        <p className="border-t pt-3 text-muted-foreground">{t.recommendation}</p>
      </CardContent>
    </Card>
  )
}

function CapitalCard({ result }: { result: VendorProspectiveResult }) {
  const c = result.capitalAnalysis!
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4" />
          Capital ROI
        </CardTitle>
        <CardDescription>
          Recommended-scenario net revenue applied against equipment cost.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm md:grid-cols-2">
        <Row label="Equipment cost" value={formatCurrency(c.equipmentCost)} />
        <Row
          label="Annual maintenance"
          value={formatCurrency(c.annualMaintenanceCost)}
        />
        <Row label="Total deal value" value={formatCurrency(c.totalDealValue)} emphasis />
        <Row
          label="Payback"
          value={
            c.paybackYears != null
              ? `${c.paybackYears.toFixed(1)} yrs`
              : "never (margin too thin)"
          }
        />
        <Row label="NPV (at your discount rate)" value={formatCurrency(c.npv)} emphasis />
        {c.facilityBreakEvenPaymentPerPeriod != null && (
          <Row
            label="Facility break-even / mo"
            value={formatCurrency(c.facilityBreakEvenPaymentPerPeriod)}
          />
        )}
      </CardContent>
    </Card>
  )
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string
  value: string
  emphasis?: boolean
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={emphasis ? "font-semibold" : ""}>{value}</span>
    </div>
  )
}
