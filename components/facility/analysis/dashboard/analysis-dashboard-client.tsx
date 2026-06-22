"use client"

/**
 * Facility Analysis dashboard — orchestrator (Charles spec, 2026-06-21).
 *
 * Owns the assumption state (Financial Assumptions sliders + negotiated supply
 * saving + AI-layer strategic inputs) and recomputes the entire dashboard from
 * one {@link buildDashboardModel} call on every change. Measurable inputs are
 * seeded from the facility's real DB data ({@link FacilityAnalysisData}); the
 * unknowable financial knobs (EBITDA margin, DCF %, EV multiples, discount,
 * growth) stay as sliders. Claude adds the narrative layer on demand.
 */

import { useCallback, useMemo, useState } from "react"
import {
  DEFAULT_FACILITY_ASSUMPTIONS,
  type FacilityModelAssumptions,
} from "@/lib/financial-analysis/prospective-impact-model"
import type { FacilityAnalysisData } from "@/lib/actions/facility-analysis-data"
import type { FacilityInsightSnapshot } from "@/lib/ai/analysis-insight-schemas"
import { useFacilityAnalysisInsights } from "@/hooks/use-analysis-insights"
import { buildDashboardModel, DEFAULT_AI_INPUTS, type DashboardModel } from "./model"
import {
  CurrentStateCards,
  FinancialAssumptionsCard,
  type RevenueMode,
} from "./current-state-and-assumptions"
import {
  CategoryAspTable,
  VendorMarketShareTable,
  ContributionMarginTable,
  IndividualImpactTable,
} from "./analysis-tables"
import { ProspectiveImpactSection } from "./prospective-impact-section"
import {
  OpportunityScoreCard,
  EbitdaEvWaterfallCard,
  EvImpactPredictorCard,
  ConversionTargetsCard,
  PaybackAnalysisCard,
  ManagedCareCard,
} from "./ai-layer"
import { GrowthSimulatorCard } from "./growth-simulator-card"
import { AiInsightsPanel } from "./ai-insights-panel"
import { UploadedDataControl } from "./uploaded-data-control"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Download } from "lucide-react"
import { downloadAnalysisCsv, downloadAnalysisPdf } from "./export-analysis"

function seedAssumptions(
  data: FacilityAnalysisData,
): FacilityModelAssumptions {
  return {
    ...DEFAULT_FACILITY_ASSUMPTIONS,
    netRevenue: data.netRevenue || DEFAULT_FACILITY_ASSUMPTIONS.netRevenue,
    currentVendorSpend:
      data.currentVendorSpend || DEFAULT_FACILITY_ASSUMPTIONS.currentVendorSpend,
    annualCaseVolume:
      data.annualCaseVolume || DEFAULT_FACILITY_ASSUMPTIONS.annualCaseVolume,
  }
}

/**
 * Seed the Net Revenue control. Default to Actuals only when the measured
 * reimbursement is coherent (exceeds supply spend → `!revenueIsImplied`);
 * otherwise Manual, with the per-case figure seeded from the REAL average of
 * covered cases (`measuredReimbursement ÷ casesWithRate`), extrapolated to
 * all cases. That data-grounded seed is NOT the old spend÷30% proxy, so EBITDA
 * no longer collapses onto vendor spend (Vick 2026-06-22).
 */
function seedRevenue(data: FacilityAnalysisData): {
  mode: RevenueMode
  avgReimbursementPerCase: number
} {
  const cases = data.annualCaseVolume || DEFAULT_FACILITY_ASSUMPTIONS.annualCaseVolume
  const coveredAvg =
    data.reimbursementCoverage.withRate > 0
      ? data.measuredReimbursement / data.reimbursementCoverage.withRate
      : 0
  const fallbackPerCase = cases > 0 ? data.netRevenue / cases : 0
  return {
    mode: data.revenueIsImplied ? "manual" : "actuals",
    avgReimbursementPerCase: coveredAvg > 0 ? coveredAvg : fallbackPerCase,
  }
}

function buildSnapshot(
  model: DashboardModel,
  revenueIsImplied: boolean,
): FacilityInsightSnapshot {
  const { current, impact } = model.prospective
  return {
    currentVendorSpend: current.vendorSpend,
    netRevenue: current.netRevenue,
    revenueIsImplied,
    ebitda: current.ebitda,
    dcf: current.dcf,
    annualSupplySavings: impact.annualSupplySavings,
    impactToEbitda: impact.impactToEbitda,
    impactToMarginPoints: impact.impactToMarginPoints,
    impactToDistributableCashFlow: impact.impactToDistributableCashFlow,
    opportunityScoreOverall: model.opportunityScore.overall,
    opportunityComponents: model.opportunityScore.components.map((c) => ({
      label: c.label,
      weight: c.weight,
      score: c.score,
    })),
    evScenarios: impact.enterpriseValue.map((ev) => ({
      scenario: ev.scenario,
      multiple: ev.multiple,
      currentEv: ev.currentEv,
      futureEv: ev.futureEv,
      incrementalEv: ev.incrementalEv,
    })),
    topCategories: model.categoryAsp.slice(0, 6).map((c, i) => ({
      category: c.category,
      spend: c.spend,
      savingsOpportunity: model.categoryImpact[i]?.annualImpact ?? 0,
    })),
    topVendors: model.vendorShare.slice(0, 6).map((v) => ({
      vendor: v.vendor,
      spend: v.spend,
      share: v.share,
    })),
    managedCareLowPct: model.managedCare.lowPct,
    managedCareHighPct: model.managedCare.highPct,
  }
}

export function AnalysisDashboardClient({
  data,
}: {
  data: FacilityAnalysisData
}) {
  // Optional uploaded-file override — lets the CFO model from contract/pricing
  // data they upload instead of live COG (Vick 2026-06-21). null = live COG.
  const [override, setOverride] = useState<FacilityAnalysisData | null>(null)
  const [overrideFileName, setOverrideFileName] = useState<string | null>(null)
  const effectiveData = override ?? data

  const [assumptions, setAssumptions] = useState<FacilityModelAssumptions>(() =>
    seedAssumptions(data),
  )
  // Net Revenue control: Actuals (case-costing reimbursement) vs Manual
  // (avg reimbursement/case × cases). Seeded from the data's coverage.
  const [revenueMode, setRevenueMode] = useState<RevenueMode>(
    () => seedRevenue(data).mode,
  )
  const [avgReimbursementPerCase, setAvgReimbursementPerCase] = useState<number>(
    () => seedRevenue(data).avgReimbursementPerCase,
  )
  // Negotiated annual supply saving, stored as an absolute $ figure.
  const [savings, setSavings] = useState<number>(
    () => seedAssumptions(data).currentVendorSpend * 0.05,
  )

  const reseedFrom = useCallback((d: FacilityAnalysisData) => {
    const seeded = seedAssumptions(d)
    setAssumptions(seeded)
    setSavings(seeded.currentVendorSpend * 0.05)
    const rev = seedRevenue(d)
    setRevenueMode(rev.mode)
    setAvgReimbursementPerCase(rev.avgReimbursementPerCase)
  }, [])

  const handleApplyUpload = useCallback(
    (d: FacilityAnalysisData, fileName: string) => {
      setOverride(d)
      setOverrideFileName(fileName)
      reseedFrom(d)
    },
    [reseedFrom],
  )

  const handleResetSource = useCallback(() => {
    setOverride(null)
    setOverrideFileName(null)
    reseedFrom(data)
  }, [data, reseedFrom])

  // Effective net revenue from the Net Revenue control feeds the model — it
  // overrides the seed `assumptions.netRevenue` so EBITDA/DCF reflect the
  // chosen revenue source rather than the spend-derived proxy.
  const effectiveNetRevenue =
    revenueMode === "actuals"
      ? effectiveData.measuredReimbursement
      : avgReimbursementPerCase * assumptions.annualCaseVolume

  const effectiveAssumptions = useMemo<FacilityModelAssumptions>(
    () => ({ ...assumptions, netRevenue: effectiveNetRevenue }),
    [assumptions, effectiveNetRevenue],
  )

  const model = useMemo(
    () =>
      buildDashboardModel(
        effectiveAssumptions,
        savings,
        DEFAULT_AI_INPUTS,
        effectiveData,
      ),
    [effectiveAssumptions, savings, effectiveData],
  )

  const insights = useFacilityAnalysisInsights()

  return (
    <div className="space-y-8 p-6">
      {/* ── Current State ───────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Current State Analysis</h1>
          <p className="text-muted-foreground">
            Administrator / CFO view.{" "}
            {override
              ? `Modeled from uploaded file ${overrideFileName}.`
              : data.hasData
                ? "Modeled from your facility's live spend and case data."
                : "No facility data yet — showing a representative model you can tune."}{" "}
            Tune any assumption and every figure recalculates instantly.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <UploadedDataControl
            activeFileName={overrideFileName}
            onApply={handleApplyUpload}
            onReset={handleResetSource}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Download className="h-4 w-4" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() =>
                  void downloadAnalysisPdf(
                    model,
                    effectiveAssumptions,
                    override ? `Uploaded file: ${overrideFileName}` : "Live COG",
                  )
                }
              >
                Export PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => downloadAnalysisCsv(model)}>
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <CurrentStateCards current={model.prospective.current} />

      <FinancialAssumptionsCard
        assumptions={effectiveAssumptions}
        onChange={setAssumptions}
        revenue={{
          mode: revenueMode,
          onModeChange: setRevenueMode,
          avgReimbursementPerCase,
          onAvgReimbursementChange: setAvgReimbursementPerCase,
          measuredReimbursement: effectiveData.measuredReimbursement,
          coverage: effectiveData.reimbursementCoverage,
          annualCaseVolume: assumptions.annualCaseVolume,
          netRevenue: effectiveNetRevenue,
        }}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <CategoryAspTable rows={model.categoryAsp} />
        <VendorMarketShareTable rows={model.vendorShare} />
      </div>

      <ContributionMarginTable rows={model.contributionMargin} />

      {/* ── Prospective Impact ──────────────────────────────── */}
      <ProspectiveImpactSection
        impact={model.prospective.impact}
        currentVendorSpend={assumptions.currentVendorSpend}
        onSavingsChange={setSavings}
      />

      <IndividualImpactTable rows={model.categoryImpact} />

      {/* ── AI Prospective Impact Engine ────────────────────── */}
      <div>
        <h2 className="text-xl font-bold">AI Prospective Impact Engine</h2>
        <p className="text-muted-foreground">
          Deterministic scoring with an on-demand AI read of the opportunity,
          conversion targets, managed-care reimbursement, and enterprise value.
        </p>
      </div>

      <AiInsightsPanel
        insights={insights.data}
        isPending={insights.isPending}
        error={insights.error}
        onGenerate={() =>
          insights.mutate(buildSnapshot(model, effectiveData.revenueIsImplied))
        }
      />

      <OpportunityScoreCard score={model.opportunityScore} />

      <div className="grid gap-6 lg:grid-cols-2">
        <EbitdaEvWaterfallCard waterfall={model.waterfall} />
        <EvImpactPredictorCard waterfall={model.waterfall} />
      </div>

      <ConversionTargetsCard result={model.conversionTargets} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PaybackAnalysisCard result={model.payback} />
        <ManagedCareCard prediction={model.managedCare} />
      </div>

      <GrowthSimulatorCard assumptions={assumptions} />
    </div>
  )
}
