/**
 * Facility Analysis dashboard — view-model builder.
 *
 * One pure function, {@link buildDashboardModel}, turns the assumption state
 * (sliders + top-line seeds + the negotiated supply saving) into every number
 * the dashboard renders. All UI components are purely presentational and read
 * from the returned {@link DashboardModel} — there is no per-component math.
 *
 * Fully assumption-driven (Vick, 2026-06-21): the category / vendor / procedure
 * breakdowns are seeded as PROPORTIONS of the editable top-line spend &
 * revenue, so moving any slider re-flows every table instantly. The seed
 * mirrors the orthopedic mix in Charles's screenshots.
 */

import {
  computeFacilityProspectiveModel,
  type FacilityModelAssumptions,
  type FacilityProspectiveModel,
} from "@/lib/financial-analysis/prospective-impact-model"
import {
  computeFacilityOpportunityScore,
  type FacilityOpportunityScore,
} from "@/lib/financial-analysis/facility-opportunity-score"
import {
  computeEbitdaEvWaterfall,
  type EbitdaEvWaterfall,
} from "@/lib/financial-analysis/ebitda-ev-waterfall"
import {
  computeConversionTargets,
  type ConversionTargetsResult,
} from "@/lib/financial-analysis/conversion-targets"
import {
  computePaybackAnalysis,
  type PaybackAnalysisResult,
} from "@/lib/financial-analysis/payback-analysis"
import {
  computeManagedCarePrediction,
  type ManagedCarePrediction,
} from "@/lib/financial-analysis/managed-care-predictor"
import type { FacilityAnalysisData } from "@/lib/actions/facility-analysis-data"

// ─── Seed proportions (mirror the screenshot ortho mix) ─────────

interface CategorySeed {
  category: string
  /** Share of total vendor spend. */
  spendShare: number
  /** Average selling price for the category. */
  asp: number
  /** Share of total surgical volume (proxy for physician behavior change). */
  volumeShare: number
  /** Baseline contribution margin %, fraction. */
  marginPct: number
}

interface VendorSeed {
  vendor: string
  /** Share of total vendor spend. */
  spendShare: number
}

export const CATEGORY_SEED: CategorySeed[] = [
  { category: "Joint Reconstruction", spendShare: 0.4622, asp: 3119, volumeShare: 0.35, marginPct: 0.7 },
  { category: "Spine", spendShare: 0.1763, asp: 4112, volumeShare: 0.18, marginPct: 0.7 },
  { category: "Surgical Navigation", spendShare: 0.1755, asp: 6538, volumeShare: 0.08, marginPct: 0.7 },
  { category: "Trauma", spendShare: 0.0763, asp: 723, volumeShare: 0.12, marginPct: 0.7 },
  { category: "Sports Medicine", spendShare: 0.0751, asp: 525, volumeShare: 0.18, marginPct: 0.7 },
  { category: "Wound Care", spendShare: 0.0177, asp: 650, volumeShare: 0.06, marginPct: 0.7 },
  { category: "Orthopedic Implants", spendShare: 0.0122, asp: 444, volumeShare: 0.03, marginPct: 0.7 },
]

export const VENDOR_SEED: VendorSeed[] = [
  { vendor: "Medtronic", spendShare: 0.3556 },
  { vendor: "Zimmer Biomet", spendShare: 0.2299 },
  { vendor: "Stryker", spendShare: 0.1373 },
  { vendor: "DePuy Synthes", spendShare: 0.1313 },
  { vendor: "Smith & Nephew", spendShare: 0.0818 },
  { vendor: "Arthrex", spendShare: 0.0641 },
]

// ─── View-model row types ───────────────────────────────────────

export interface CategoryAspRow {
  category: string
  spend: number
  asp: number
  share: number
}

export interface VendorShareRow {
  vendor: string
  spend: number
  share: number
}

export interface ContributionMarginRow {
  procedure: string
  cases: number
  supplyPerCase: number
  contributionMargin: number
  marginPct: number
}

export interface CategoryImpactRow {
  category: string
  cases: number
  annualImpact: number
  impactPerCase: number
  marginPct: number
  /** Margin after the prospective saving, fraction. */
  newMarginPct: number
}

// ─── AI-layer strategic inputs (sliders/toggles on the page) ────

export interface DashboardAiInputs {
  /** Top-vendor concentration, fraction (0–1). */
  vendorConcentrationPct: number
  cashFlowTimingScore: number
  growthAlignmentScore: number
  technologyEnablementScore: number
  /** Waterfall levers ($). */
  implantSavings: number
  rebateValue: number
  growthImpact: number
  laborSavings: number
  throughputImpact: number
  evMultiple: number
  /** Payback. */
  investmentCost: number
  expectedAnnualBenefit: number
  /** Managed care. */
  caseMixAcuity: number
  outcomesScore: number
  marketStrength: number
}

export interface DashboardModel {
  assumptions: FacilityModelAssumptions
  prospective: FacilityProspectiveModel
  categoryAsp: CategoryAspRow[]
  vendorShare: VendorShareRow[]
  contributionMargin: ContributionMarginRow[]
  categoryImpact: CategoryImpactRow[]
  opportunityScore: FacilityOpportunityScore
  waterfall: EbitdaEvWaterfall
  conversionTargets: ConversionTargetsResult
  payback: PaybackAnalysisResult
  managedCare: ManagedCarePrediction
}

export const DEFAULT_AI_INPUTS: DashboardAiInputs = {
  vendorConcentrationPct: 0.356,
  cashFlowTimingScore: 70,
  growthAlignmentScore: 75,
  technologyEnablementScore: 60,
  implantSavings: 450_000,
  rebateValue: 175_000,
  growthImpact: 120_000,
  laborSavings: 90_000,
  throughputImpact: 110_000,
  evMultiple: 12,
  investmentCost: 1_800_000,
  expectedAnnualBenefit: 650_000,
  caseMixAcuity: 0.7,
  outcomesScore: 0.75,
  marketStrength: 0.65,
}

// ─── Builder ────────────────────────────────────────────────────

export function buildDashboardModel(
  assumptions: FacilityModelAssumptions,
  annualSupplySavings: number,
  ai: DashboardAiInputs,
  data?: FacilityAnalysisData,
): DashboardModel {
  const prospective = computeFacilityProspectiveModel(
    assumptions,
    annualSupplySavings,
  )

  const totalSpend = assumptions.currentVendorSpend
  const netRevenue = assumptions.netRevenue
  const totalVolume = assumptions.annualCaseVolume

  // Breakdown source: real DB shares when the facility has COG, else the
  // representative seed mix. Both carry { spendShare, asp, volumeShare,
  // marginPct } so spend re-flows when the spend slider moves.
  const categorySource = data?.hasData ? data.categories : CATEGORY_SEED
  const vendorSource = data?.hasData ? data.vendors : VENDOR_SEED

  // Category Spend & ASP.
  const categoryAsp: CategoryAspRow[] = categorySource.map((c) => ({
    category: c.category,
    spend: totalSpend * c.spendShare,
    asp: c.asp,
    share: c.spendShare,
  }))

  // Vendor Market Share.
  const vendorShare: VendorShareRow[] = vendorSource.map((v) => ({
    vendor: v.vendor,
    spend: totalSpend * v.spendShare,
    share: v.spendShare,
  }))

  // Contribution Margin by Procedure — revenue allocated by volume share.
  const contributionMargin: ContributionMarginRow[] = categorySource.map((c) => {
    const categoryRevenue = netRevenue * c.volumeShare
    const cases = Math.round(totalVolume * c.volumeShare)
    return {
      procedure: c.category,
      cases,
      supplyPerCase: cases > 0 ? (totalSpend * c.spendShare) / cases : 0,
      contributionMargin: categoryRevenue * c.marginPct,
      marginPct: c.marginPct,
    }
  })

  // Individual Impact by Category & Case — savings allocated by spend share.
  const savings = prospective.impact.annualSupplySavings
  const categoryImpact: CategoryImpactRow[] = categorySource.map((c) => {
    const annualImpact = savings * c.spendShare
    const cases = Math.round(totalVolume * c.volumeShare)
    const categoryRevenue = netRevenue * c.volumeShare
    const marginLift =
      categoryRevenue > 0 ? annualImpact / categoryRevenue : 0
    return {
      category: c.category,
      cases,
      annualImpact,
      impactPerCase: cases > 0 ? annualImpact / cases : 0,
      marginPct: c.marginPct,
      newMarginPct: c.marginPct + marginLift,
    }
  })

  // AI layer.
  const opportunityScore = computeFacilityOpportunityScore({
    model: prospective,
    vendorConcentrationPct:
      data?.hasData ? data.topVendorConcentrationPct : ai.vendorConcentrationPct,
    cashFlowTimingScore: ai.cashFlowTimingScore,
    growthAlignmentScore: ai.growthAlignmentScore,
    technologyEnablementScore: ai.technologyEnablementScore,
  })

  const waterfall = computeEbitdaEvWaterfall(
    {
      currentEbitda: prospective.current.ebitda,
      implantSavings: ai.implantSavings,
      rebateValue: ai.rebateValue,
      growthImpact: ai.growthImpact,
      laborSavings: ai.laborSavings,
      throughputImpact: ai.throughputImpact,
    },
    ai.evMultiple,
  )

  const conversionTargets = computeConversionTargets(
    categorySource.map((c) => ({
      category: c.category,
      savingsOpportunity: savings * c.spendShare,
      volumeSharePct: c.volumeShare,
      aboveBenchmarkAsp: c.asp > 2000,
    })),
  )

  const payback = computePaybackAnalysis({
    investmentCost: ai.investmentCost,
    expectedAnnualBenefit: ai.expectedAnnualBenefit,
  })

  const managedCare = computeManagedCarePrediction({
    caseMixAcuity: ai.caseMixAcuity,
    outcomesScore: ai.outcomesScore,
    annualCaseVolume: assumptions.annualCaseVolume,
    marketStrength: ai.marketStrength,
  })

  return {
    assumptions,
    prospective,
    categoryAsp,
    vendorShare,
    contributionMargin,
    categoryImpact,
    opportunityScore,
    waterfall,
    conversionTargets,
    payback,
    managedCare,
  }
}
