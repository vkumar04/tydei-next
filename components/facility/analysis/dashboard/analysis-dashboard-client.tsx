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
  // Negotiated annual supply saving, stored as an absolute $ figure.
  const [savings, setSavings] = useState<number>(
    () => seedAssumptions(data).currentVendorSpend * 0.05,
  )

  const reseedFrom = useCallback((d: FacilityAnalysisData) => {
    const seeded = seedAssumptions(d)
    setAssumptions(seeded)
    setSavings(seeded.currentVendorSpend * 0.05)
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

  const model = useMemo(
    () =>
      buildDashboardModel(assumptions, savings, DEFAULT_AI_INPUTS, effectiveData),
    [assumptions, savings, effectiveData],
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
                    assumptions,
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
        assumptions={assumptions}
        onChange={setAssumptions}
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
