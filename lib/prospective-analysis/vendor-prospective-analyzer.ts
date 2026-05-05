/**
 * Vendor Prospective Analysis Engine
 *
 * Pure function. Zero Prisma, zero IO. Callers (server actions) are
 * responsible for loading benchmarks, contracts, COG data, and
 * shaping the input.
 *
 * Ported from Charles canonical Prospective Analysis Engine 2026-04-18.
 * See:
 *   - docs/superpowers/charles-canonical-engines/prospective-analysis.ts
 *   - docs/superpowers/audits/2026-05-04-prospective-analysis-audit.md
 *     (gap #1 — vendor-side analyzer was the entire missing piece)
 *
 * The engine answers FOUR questions for a vendor evaluating a proposal:
 *
 *   1. **Which scenario should I lead with?** (scenario margin analysis)
 *   2. **What's at risk if I push too hard?** (revenue-at-risk on
 *      current share)
 *   3. **What's the upside if I land it?** (penetration analysis —
 *      incremental revenue from current → target share)
 *   4. **For capital deals, when do I get my equipment cost back?**
 *      (capitalAnalysis — payback, NPV, total deal value)
 *
 * Plus tier-optimization advice: which tier did the recommended
 * scenario achieve, and what's the marginal cost / additional rebate
 * to push the facility into the next bracket.
 *
 * **Math units:** all rebatePercent / rebateValue inputs on the
 * VendorProspectiveInput surface are integer-percent (5 = 5%), to
 * match what a vendor user types in a form. Conversions to/from the
 * Prisma 0.05 fraction units happen at the server-action boundary,
 * not here.
 */

import type {
  RebateConfig,
  RebateTier,
  TierBoundaryRule,
} from "@/lib/rebates/engine/types"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"

// ─── Input types ───────────────────────────────────────────────

export type VendorFacilityType = "HOSPITAL" | "ASC" | "IDN" | "CLINIC"

export type VendorContractVariant =
  | "USAGE_SPEND"
  | "USAGE_VOLUME"
  | "USAGE_MARKET_SHARE"
  | "CAPITAL_OUTRIGHT"
  | "CAPITAL_LEASE"
  | "CAPITAL_TIE_IN"
  | "SERVICE_FIXED"
  | "SERVICE_VARIABLE"
  | "GPO"
  | "PRICING_ONLY"

export interface VendorPricingScenario {
  scenarioName: string // e.g. "Floor", "Target", "Ceiling"
  unitPrice: number
  estimatedAnnualVolume: number
  rebatePercent?: number // integer percent, e.g. 5 = 5%
  notes?: string
}

export interface BenchmarkDataPoint {
  vendorItemNo?: string
  category?: string | null
  /** Vendor's own internal benchmark — proprietary list price / cost basis. */
  internalListPrice?: number | null
  /** Vendor's true unit COGS (cost-of-goods-sold). When absent, engine
   *  falls back to the 55% gross-margin assumption. */
  internalUnitCost?: number | null
  nationalAvgPrice?: number | null
}

export interface CapitalDealDetails {
  equipmentCost: number
  /** Annual interest rate as decimal (0.05 = 5%). */
  interestRate?: number
  termMonths?: number
  /** Annual recurring maintenance the vendor must absorb. */
  annualMaintenanceCost?: number
  /** Discount rate for NPV calc as decimal (default 0.10). */
  discountRate?: number
}

export interface VendorProspectiveInput {
  facilityId: string
  facilityName: string
  facilityType: VendorFacilityType
  facilityAnnualCaseVolume?: number
  contractVariant: VendorContractVariant

  pricingScenarios: VendorPricingScenario[]
  /** Optional: a proposed RebateConfig used for tier-optimization analysis. */
  proposedRebateConfig?: RebateConfig

  benchmarks: BenchmarkDataPoint[]

  /** Estimated total annual spend from the facility on this category. */
  facilityEstimatedAnnualSpend: number
  /** Vendor's current share of that spend, decimal (0.0–1.0). */
  facilityCurrentVendorShare?: number
  /** Vendor's target share for this proposal, decimal (0.0–1.0). */
  targetVendorShare?: number

  capitalDetails?: CapitalDealDetails

  /** Decimal margin targets (0.40 = 40%). */
  targetGrossMarginPercent: number
  minimumAcceptableGrossMarginPercent: number
}

// ─── Result types ──────────────────────────────────────────────

export interface VendorScenarioResult {
  scenarioName: string
  unitPrice: number
  estimatedAnnualVolume: number
  annualRevenue: number
  annualRebatePaid: number
  netRevenue: number
  estimatedCOGS: number
  grossProfit: number
  grossMarginPercent: number // decimal (0.40 = 40%)
  meetsTargetMargin: boolean
  meetsFloorMargin: boolean
  /** % discount from vendor's internal list (positive = discounted). */
  discountFromBenchmarkList: number | null
  notes?: string
}

export interface PenetrationAnalysis {
  currentShare: number // decimal
  targetShare: number // decimal
  currentAnnualRevenue: number
  targetAnnualRevenue: number
  incrementalRevenueOpportunity: number
}

export interface CapitalAnalysisResult {
  equipmentCost: number
  annualMaintenanceCost: number
  /** Sum of recommended-scenario net revenue × termYears. */
  totalDealValue: number
  /** Years until cumulative net revenue >= equipmentCost. null if never. */
  paybackYears: number | null
  /** NPV of the deal cash flows minus equipment + maintenance, discounted. */
  npv: number
  /** Per-period equal-payment amount the facility owes (info only). */
  facilityBreakEvenPaymentPerPeriod: number | null
}

export interface TierOptimizationResult {
  achievedTier: RebateTier | null
  /** Distance in spend $ to the next tier (null if already at top, or
   *  no tiered rebate config supplied). */
  distanceToNextTier: number | null
  /** Additional rebate $ the facility would earn at the next tier. */
  additionalRebateAtNextTier: number | null
  /** Plain-English recommendation. Always populated. */
  recommendation: string
}

export interface VendorProspectiveResult {
  scenarioResults: VendorScenarioResult[]
  /** Best scenario above the minimum floor (max margin). null if none. */
  recommendedScenario: VendorScenarioResult | null
  /** Current revenue exposed if the facility walks. */
  revenueAtRisk: number
  penetrationAnalysis: PenetrationAnalysis
  capitalAnalysis: CapitalAnalysisResult | null
  tierOptimization: TierOptimizationResult
  warnings: string[]
}

// ─── Analyzer ──────────────────────────────────────────────────

/** Default vendor gross margin when no internal cost basis provided.
 *  Charles spec: "55% gross margin assumption". */
const DEFAULT_GROSS_MARGIN = 0.45 // i.e. COGS ratio

export function analyzeVendorProspective(
  input: VendorProspectiveInput,
): VendorProspectiveResult {
  const warnings: string[] = []

  if (input.pricingScenarios.length === 0) {
    warnings.push("No pricing scenarios provided — cannot analyze.")
  }

  // Pull the best-quality internal cost basis we can find.
  const internalUnitCost = pickInternalUnitCost(input.benchmarks)
  const internalListPrice = pickInternalListPrice(input.benchmarks)

  if (internalUnitCost == null) {
    warnings.push(
      "No internal unit cost provided — falling back to 55% gross-margin (45% COGS) assumption.",
    )
  }

  // ── 1. Scenario evaluation ───────────────────────────────────
  const scenarioResults: VendorScenarioResult[] = input.pricingScenarios.map(
    (s) => evaluateScenario(s, {
      internalUnitCost,
      internalListPrice,
      targetMargin: input.targetGrossMarginPercent,
      floorMargin: input.minimumAcceptableGrossMarginPercent,
    }),
  )

  // ── 2. Recommended scenario ──────────────────────────────────
  const passing = scenarioResults.filter((s) => s.meetsFloorMargin)
  const recommendedScenario =
    passing.length > 0
      ? passing.reduce((best, s) =>
          s.grossMarginPercent > best.grossMarginPercent ? s : best,
        )
      : null

  if (!recommendedScenario && scenarioResults.length > 0) {
    warnings.push(
      "No scenario meets the minimum acceptable gross-margin floor — every offer would lose money for the vendor.",
    )
  }

  // ── 3. Revenue at risk ───────────────────────────────────────
  const currentShare = input.facilityCurrentVendorShare ?? 0
  const targetShare =
    input.targetVendorShare ?? Math.max(currentShare, 0.5) // default: try for 50%
  const revenueAtRisk = input.facilityEstimatedAnnualSpend * currentShare

  // ── 4. Penetration analysis ──────────────────────────────────
  const penetrationAnalysis: PenetrationAnalysis = {
    currentShare,
    targetShare,
    currentAnnualRevenue: revenueAtRisk,
    targetAnnualRevenue: input.facilityEstimatedAnnualSpend * targetShare,
    incrementalRevenueOpportunity:
      input.facilityEstimatedAnnualSpend *
      Math.max(0, targetShare - currentShare),
  }

  // ── 5. Capital analysis ──────────────────────────────────────
  const capitalAnalysis = isCapitalVariant(input.contractVariant)
    ? analyzeCapitalDeal({
        capital: input.capitalDetails,
        recommendedScenarioNetRevenue: recommendedScenario?.netRevenue ?? 0,
        warnings,
      })
    : null

  // ── 6. Tier optimization ─────────────────────────────────────
  const tierOptimization = analyzeTierOptimization({
    config: input.proposedRebateConfig,
    recommendedAnnualRevenue: recommendedScenario?.annualRevenue ?? 0,
  })

  return {
    scenarioResults,
    recommendedScenario,
    revenueAtRisk,
    penetrationAnalysis,
    capitalAnalysis,
    tierOptimization,
    warnings,
  }
}

// ─── Helpers ───────────────────────────────────────────────────

function evaluateScenario(
  s: VendorPricingScenario,
  ctx: {
    internalUnitCost: number | null
    internalListPrice: number | null
    targetMargin: number
    floorMargin: number
  },
): VendorScenarioResult {
  const annualRevenue = s.unitPrice * s.estimatedAnnualVolume
  const rebateRate = (s.rebatePercent ?? 0) / 100
  const annualRebatePaid = annualRevenue * rebateRate
  const netRevenue = annualRevenue - annualRebatePaid

  const unitCost =
    ctx.internalUnitCost != null
      ? ctx.internalUnitCost
      : s.unitPrice * DEFAULT_GROSS_MARGIN

  const estimatedCOGS = unitCost * s.estimatedAnnualVolume
  const grossProfit = netRevenue - estimatedCOGS
  const grossMarginPercent =
    netRevenue > 0 ? grossProfit / netRevenue : 0

  const discountFromBenchmarkList =
    ctx.internalListPrice && ctx.internalListPrice > 0
      ? (ctx.internalListPrice - s.unitPrice) / ctx.internalListPrice
      : null

  return {
    scenarioName: s.scenarioName,
    unitPrice: s.unitPrice,
    estimatedAnnualVolume: s.estimatedAnnualVolume,
    annualRevenue,
    annualRebatePaid,
    netRevenue,
    estimatedCOGS,
    grossProfit,
    grossMarginPercent,
    meetsTargetMargin: grossMarginPercent >= ctx.targetMargin,
    meetsFloorMargin: grossMarginPercent >= ctx.floorMargin,
    discountFromBenchmarkList,
    notes: s.notes,
  }
}

function pickInternalUnitCost(benchmarks: BenchmarkDataPoint[]): number | null {
  for (const b of benchmarks) {
    if (b.internalUnitCost != null && b.internalUnitCost > 0) {
      return b.internalUnitCost
    }
  }
  return null
}

function pickInternalListPrice(
  benchmarks: BenchmarkDataPoint[],
): number | null {
  for (const b of benchmarks) {
    if (b.internalListPrice != null && b.internalListPrice > 0) {
      return b.internalListPrice
    }
  }
  // fall back to national avg if no internal list
  for (const b of benchmarks) {
    if (b.nationalAvgPrice != null && b.nationalAvgPrice > 0) {
      return b.nationalAvgPrice
    }
  }
  return null
}

function isCapitalVariant(v: VendorContractVariant): boolean {
  return v === "CAPITAL_OUTRIGHT" || v === "CAPITAL_LEASE" || v === "CAPITAL_TIE_IN"
}

function analyzeCapitalDeal(args: {
  capital?: CapitalDealDetails
  recommendedScenarioNetRevenue: number
  warnings: string[]
}): CapitalAnalysisResult | null {
  const { capital, recommendedScenarioNetRevenue, warnings } = args
  if (!capital) {
    warnings.push(
      "Contract variant is capital, but no capitalDetails provided — capital analysis omitted.",
    )
    return null
  }

  const equipmentCost = capital.equipmentCost
  const maintenance = capital.annualMaintenanceCost ?? 0
  const termMonths = capital.termMonths ?? 60
  const termYears = termMonths / 12
  const discountRate = capital.discountRate ?? 0.1

  // Total nominal deal value = recommended-scenario annual net × termYears.
  const totalDealValue = recommendedScenarioNetRevenue * termYears

  // Payback in years: equipmentCost / (annual net revenue - maintenance)
  const annualNetAfterMaintenance = recommendedScenarioNetRevenue - maintenance
  const paybackYears =
    annualNetAfterMaintenance > 0
      ? equipmentCost / annualNetAfterMaintenance
      : null

  // NPV: -equipmentCost + Σ (annualNetAfterMaintenance / (1+r)^t)
  let npv = -equipmentCost
  for (let t = 1; t <= termYears; t++) {
    npv += annualNetAfterMaintenance / Math.pow(1 + discountRate, t)
  }

  // Facility break-even payment (info: what the facility would pay
  // under a straight-line capital lease on the same equipment).
  const facilityBreakEvenPaymentPerPeriod =
    capital.interestRate != null && termMonths > 0
      ? amortizationPayment(equipmentCost, capital.interestRate / 12, termMonths)
      : null

  return {
    equipmentCost,
    annualMaintenanceCost: maintenance,
    totalDealValue,
    paybackYears,
    npv,
    facilityBreakEvenPaymentPerPeriod,
  }
}

function amortizationPayment(
  principal: number,
  monthlyRate: number,
  months: number,
): number {
  if (monthlyRate === 0) return principal / months
  const f = Math.pow(1 + monthlyRate, months)
  return (principal * monthlyRate * f) / (f - 1)
}

function analyzeTierOptimization(args: {
  config?: RebateConfig
  recommendedAnnualRevenue: number
}): TierOptimizationResult {
  const { config, recommendedAnnualRevenue } = args

  if (!config || !("tiers" in config) || !config.tiers || config.tiers.length === 0) {
    return {
      achievedTier: null,
      distanceToNextTier: null,
      additionalRebateAtNextTier: null,
      recommendation:
        "No tiered rebate config supplied — tier optimization not available.",
    }
  }

  const boundaryRule: TierBoundaryRule =
    "boundaryRule" in config && config.boundaryRule
      ? config.boundaryRule
      : "EXCLUSIVE"

  const tiers = [...config.tiers].sort((a, b) => a.thresholdMin - b.thresholdMin)
  const achieved = determineTier(recommendedAnnualRevenue, tiers, boundaryRule)

  // Find the next tier above what was achieved.
  const achievedIdx = achieved
    ? tiers.findIndex((t) => t.tierNumber === achieved.tierNumber)
    : -1
  const nextTier = achievedIdx >= 0 ? tiers[achievedIdx + 1] : tiers[0]

  if (!nextTier) {
    return {
      achievedTier: achieved,
      distanceToNextTier: null,
      additionalRebateAtNextTier: null,
      recommendation: achieved
        ? `Recommended scenario lands in the top tier (${achieved.tierName ?? `Tier ${achieved.tierNumber}`}). No further upside available.`
        : "No tier reached at the recommended-scenario revenue.",
    }
  }

  const distanceToNextTier = Math.max(
    0,
    nextTier.thresholdMin - recommendedAnnualRevenue,
  )

  // additionalRebate: rebate at next tier minus rebate at current tier,
  // both evaluated on a hypothetical revenue equal to nextTier.thresholdMin.
  // (We use rebateValue as a fractional rate where < 1, otherwise treat
  // as integer percent and divide by 100.)
  const currentRate = achieved ? rateAsFraction(achieved.rebateValue) : 0
  const nextRate = rateAsFraction(nextTier.rebateValue)
  const revenueAtNextTier = nextTier.thresholdMin
  const additionalRebateAtNextTier =
    revenueAtNextTier * nextRate - revenueAtNextTier * currentRate

  const recommendation = achieved
    ? `Recommended scenario lands in ${achieved.tierName ?? `Tier ${achieved.tierNumber}`} (rebate ${fmtPct(currentRate)}). Push another $${fmt(distanceToNextTier)} of revenue to reach ${nextTier.tierName ?? `Tier ${nextTier.tierNumber}`} (${fmtPct(nextRate)}) — that's an extra $${fmt(additionalRebateAtNextTier)} per year for the facility.`
    : `Recommended scenario does not yet reach the lowest tier ($${fmt(nextTier.thresholdMin)}). Need another $${fmt(distanceToNextTier)} of revenue to start earning rebates.`

  return {
    achievedTier: achieved,
    distanceToNextTier,
    additionalRebateAtNextTier,
    recommendation,
  }
}

function rateAsFraction(v: number): number {
  // RebateTier.rebateValue is stored as a fraction in Prisma (0.05 = 5%),
  // but vendor-form-typed values are integer-percent (5 = 5%).
  // Normalize defensively: anything > 1 is assumed integer-percent.
  return v > 1 ? v / 100 : v
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US")
}

function fmtPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}
