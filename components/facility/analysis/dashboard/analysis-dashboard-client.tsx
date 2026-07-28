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
import { AlertTriangle, Download } from "lucide-react"
import Link from "next/link"
import { downloadAnalysisCsv, downloadAnalysisPdf } from "./export-analysis"

/**
 * Seed the model sliders.
 *
 * `sample` = the user explicitly asked to see the illustrative mid-size-ASC
 * model. Only then may DEFAULT_FACILITY_ASSUMPTIONS stand in for a missing
 * figure.
 *
 * Charles 2026-07-27 ("With no data in COG this is still coming up"): these
 * three fields used `||` fallbacks, so a facility with no COG rows —
 * `currentVendorSpend: 0` — silently became `0 || 12_500_000` and the page
 * presented $12.5M of vendor spend, a $1.0M EBITDA and an $11.9M DCF as if
 * they were the facility's own numbers. A zero is real data, not a missing
 * value, so it now flows through untouched and the caller renders an empty
 * state instead.
 */
export function seedAssumptions(
  data: FacilityAnalysisData,
  sample = false,
): FacilityModelAssumptions {
  if (sample) return { ...DEFAULT_FACILITY_ASSUMPTIONS }
  return {
    // The genuinely-unknowable knobs (margin %, discount rate, growth, DCF
    // horizon) still seed from defaults — those are modeling choices, not
    // facility data.
    ...DEFAULT_FACILITY_ASSUMPTIONS,
    netRevenue: data.netRevenue,
    currentVendorSpend: data.currentVendorSpend,
    annualCaseVolume: data.annualCaseVolume,
  }
}

/**
 * Seed the Net Revenue control.
 *
 * Mode is Actuals only when the measured reimbursement is coherent (exceeds
 * supply spend → `!revenueIsImplied`); otherwise Manual.
 *
 * The per-case seed depends on which of those it is:
 *   - NOT implied → the real average of covered cases
 *     (`measuredReimbursement ÷ casesWithRate`). Data-grounded, and what the
 *     user sees if they flip to Manual (Vick 2026-06-22).
 *   - IMPLIED → the proxy the loader already substituted, divided by the same
 *     case count, so Manual mode agrees with the headline instead of silently
 *     reverting to the figure the loader rejected. See the note below.
 */
export function seedRevenue(
  data: FacilityAnalysisData,
  sample = false,
): {
  mode: RevenueMode
  avgReimbursementPerCase: number
} {
  const cases = sample
    ? DEFAULT_FACILITY_ASSUMPTIONS.annualCaseVolume
    : data.annualCaseVolume
  const coveredAvg =
    data.reimbursementCoverage.withRate > 0
      ? data.measuredReimbursement / data.reimbursementCoverage.withRate
      : 0
  const fallbackPerCase = cases > 0 ? data.netRevenue / cases : 0
  return {
    mode: data.revenueIsImplied ? "manual" : "actuals",
    // 2026-07-27: when revenue is IMPLIED, seed from the PROXY, not from the
    // measured average.
    //
    // getFacilityAnalysisData sets `revenueIsImplied` exactly when the measured
    // reimbursement is missing or implausibly low (≤ supply spend), and
    // substitutes `totalSpend / IMPLIED_SUPPLY_COST_PCT` "so EBITDA/DCF stay
    // coherent" (facility-analysis-data.ts:165-175). This function then put the
    // page straight back into the state that fix existed to prevent: implied ⇒
    // mode "manual", and manual revenue is `avgReimbursementPerCase × cases` —
    // so seeding from `coveredAvg` (measured ÷ covered cases) multiplied back to
    // the measured figure and the proxy was computed and thrown away.
    //
    // Lighthouse Surgical Center showed it: $1.45M trailing-12-month supply
    // spend, 40 cases, $441,247 measured reimbursement over 40 covered cases.
    // Proxy = $4.82M, but the page rendered Net Revenue $441,247 — BELOW its own
    // supply spend, i.e. a negative gross margin, with EBITDA derived from it.
    // `fallbackPerCase` divides the proxy by the same case count, so manual mode
    // reproduces the proxy instead of contradicting it.
    avgReimbursementPerCase: data.revenueIsImplied
      ? fallbackPerCase
      : coveredAvg > 0
        ? coveredAvg
        : fallbackPerCase,
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

  // Explicit opt-in to the illustrative mid-size-ASC model. Off by default:
  // with no COG data the page must not invent a facility (Charles 2026-07-27).
  const [sampleMode, setSampleMode] = useState(false)
  // No live COG, no uploaded file, and no opt-in → there is nothing to model.
  const showEmptyState = !override && !data.hasData && !sampleMode

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

  const reseedFrom = useCallback(
    (d: FacilityAnalysisData, sample = false) => {
      const seeded = seedAssumptions(d, sample)
      setAssumptions(seeded)
      setSavings(seeded.currentVendorSpend * 0.05)
      const rev = seedRevenue(d, sample)
      setRevenueMode(rev.mode)
      setAvgReimbursementPerCase(rev.avgReimbursementPerCase)
    },
    [],
  )

  const handleShowSampleModel = useCallback(() => {
    setSampleMode(true)
    reseedFrom(data, true)
  }, [data, reseedFrom])

  const handleApplyUpload = useCallback(
    (d: FacilityAnalysisData, fileName: string) => {
      setOverride(d)
      setOverrideFileName(fileName)
      // Real uploaded numbers supersede the illustrative model.
      setSampleMode(false)
      reseedFrom(d)
    },
    [reseedFrom],
  )

  const handleResetSource = useCallback(() => {
    setOverride(null)
    setOverrideFileName(null)
    setSampleMode(false)
    reseedFrom(data)
  }, [data, reseedFrom])

  // Effective net revenue from the Net Revenue control feeds the model — it
  // overrides the seed `assumptions.netRevenue` so EBITDA/DCF reflect the
  // chosen revenue source rather than the spend-derived proxy.
  //
  // Manual revenue is `perCase × cases`, which is structurally $0 when the
  // facility has no case-costing data — and $0 revenue against real supply
  // spend is incoherent, not honest. Removing the old `annualCaseVolume ||
  // 5_000` fabrication (Charles 2026-07-27) exposed this: the fake case count
  // had been the only thing keeping the loader's spend-derived proxy alive on
  // such a facility. With no cases, fall back to that proxy — it is derived
  // from spend, not from cases, so it stays meaningful — and let the operator
  // enter a real case volume to take over.
  //
  // The fallback is gated on the PER-CASE RATE, not on the case count. Gating on
  // the count was a regression (2026-07-28 sweep): for a facility with no cases
  // the seeded rate is $0 — there were no cases to average — so the moment an
  // operator typed a case volume into "Annual cases" the gate flipped to the
  // manual branch and computed `$0 × N = $0`, collapsing Net Revenue, EBITDA and
  // DCF to zero on a facility that has real supply spend. Revenue is rate ×
  // cases; with no rate it is not computable from cases at all, so the
  // spend-derived proxy must stand until the operator supplies a rate.
  const manualNetRevenue = avgReimbursementPerCase * assumptions.annualCaseVolume
  const effectiveNetRevenue =
    revenueMode === "actuals"
      ? effectiveData.measuredReimbursement
      : avgReimbursementPerCase > 0
        ? manualNetRevenue
        : assumptions.netRevenue

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
                : sampleMode
                  ? "Sample model — illustrative figures, not this facility's data."
                  : "No COG spend data yet."}{" "}
            {!showEmptyState &&
              "Tune any assumption and every figure recalculates instantly."}
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
              {/* Nothing to export while the page has no facility data —
                  exporting the sample model would put fabricated figures in a
                  file that outlives the on-screen disclaimer. */}
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={showEmptyState || sampleMode}
              >
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
              <DropdownMenuItem
                onSelect={() => downloadAnalysisCsv(model, effectiveAssumptions)}
              >
                Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showEmptyState ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <h2 className="text-lg font-semibold">No COG spend data yet</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
            The Current State model is built from your facility&apos;s supply
            spend. Import COG data or model from a contract / pricing file to
            see your vendor spend, EBITDA and enterprise-value figures.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Button asChild size="sm">
              <Link href="/dashboard/cog-data">Import COG data</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={handleShowSampleModel}>
              Show sample model
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            The sample model is an illustrative mid-size ASC — useful for a
            walkthrough, but none of it is your facility&apos;s data.
          </p>
        </div>
      ) : (
        <>
          {sampleMode && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <div className="space-y-1">
                <p className="font-medium">
                  Sample model — not this facility&apos;s data
                </p>
                <p className="text-muted-foreground">
                  Every figure below is an illustrative default for a mid-size
                  ASC. Import COG data or upload a pricing file to model your own
                  numbers.{" "}
                  <button
                    type="button"
                    className="underline underline-offset-2"
                    onClick={handleResetSource}
                  >
                    Exit sample model
                  </button>
                </p>
              </div>
            </div>
          )}

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
        </>
      )}
    </div>
  )
}
