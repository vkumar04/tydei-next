/**
 * Unified rebate engine — shared types.
 *
 * Reference: docs/superpowers/specs/2026-04-18-rebate-term-types-extension.md §4
 *
 * The engine is pure: zero Prisma imports, zero side effects. Callers
 * load data from the DB and build typed RebateConfig objects per term;
 * the engine returns standardized RebateResult.
 *
 * ─── Audit fixes [A1]-[A10] ──────────────────────────────────────
 *
 * [A1] determineTier EXCLUSIVE: scan-to-end, return highest qualifying
 * [A2] calculateMarginalRebate: no cent-rounding; exact bracket sums
 * [A3] INCLUSIVE boundary handled via bracket capacity (no special case)
 * [A4] amountToNextTier uses totalSpend (not growth-adjusted) so alerts
 *      show real dollar distance
 * [A5] Volume rebate dedup prefers caseId+cptCode; baseline in occurrences
 * [A6] Market share rebate: separates % threshold from dollar calc
 * [A7] Tier/market-share price reductions: per-line PriceReductionLineResult
 *      (no single aggregate effectiveUnitPrice — meaningless across
 *      mixed unit prices)
 * [A8] Capitated: pre-filters + passes spendBasis: 'ALL_SPEND' to
 *      sub-calculators (no double-filter)
 * [A9] allocateRebatesToProcedures: guards against zero reimbursement;
 *      adds priceReductionAllocation + totalContractBenefit
 * [A10] True-up sign convention: positive = facility owed MORE;
 *       negative = over-accrued. Across all 8 types.
 */

// ─── Core enums ───────────────────────────────────────────────

export type RebateType =
  | "SPEND_REBATE"
  | "VOLUME_REBATE"
  | "TIER_PRICE_REDUCTION"
  | "MARKET_SHARE_REBATE"
  | "MARKET_SHARE_PRICE_REDUCTION"
  | "CAPITATED"
  | "CARVE_OUT"
  | "TIE_IN_CAPITAL"

export type TierMethod = "CUMULATIVE" | "MARGINAL"

export type TierBoundaryRule = "EXCLUSIVE" | "INCLUSIVE"

export type BaselineType =
  | "PRIOR_YEAR_ACTUAL"
  | "NEGOTIATED_FIXED"
  | "NONE" // no growth math — evaluate on totalSpend directly

export type SpendBasis =
  | "ALL_SPEND"
  | "REFERENCE_NUMBER"
  | "PRODUCT_CATEGORY"
  | "MULTI_CATEGORY"

export type PriceReductionTrigger = "RETROACTIVE" | "FORWARD_ONLY"

export type TrueUpShortfallHandling = "BILL_IMMEDIATELY" | "CARRY_FORWARD"

export type CarveOutRateType = "PERCENT_OF_SPEND" | "FIXED_PER_UNIT"

// ─── Tier shape ───────────────────────────────────────────────

export interface RebateTier {
  tierNumber: number
  tierName?: string | null
  /** Lower bound of the tier; units depend on the config (spend | volume | share %). */
  thresholdMin: number
  /** Upper bound; null = "and above". */
  thresholdMax: number | null
  /** Primary rebate rate expressed per config type (% of spend, $/unit, etc.). */
  rebateValue: number
  /** For TIER_PRICE_REDUCTION: absolute reduced unit price. */
  reducedPrice?: number | null
  /** For TIER_PRICE_REDUCTION: fractional price reduction (0.10 = 10% off). */
  priceReductionPercent?: number | null
  /** Fixed-dollar rebate at this tier (optional; overrides rebateValue math). */
  fixedRebateAmount?: number | null
}

// ─── Purchase + period data ────────────────────────────────────

export interface PurchaseRecord {
  referenceNumber: string
  productCategory?: string | null
  quantity: number
  unitPrice: number
  extendedPrice: number
  purchaseDate: Date
  cptCode?: string | null
  caseId?: string | null
}

export interface PeriodData {
  /** Every purchase in the evaluation window (pre-filter by caller if needed). */
  purchases: PurchaseRecord[]
  /** Sum of all purchases (all products, all references). Pre-computed. */
  totalSpend: number
  /** Optional: period total category spend (for market-share calculations). */
  totalCategorySpend?: number | null
  /** Optional: vendor category spend (for market-share). */
  vendorCategorySpend?: number | null
  /** Optional: accruals earned in prior periods under the same term. */
  priorAccruals?: number | null
  /** Optional: prior-year actual spend for growth baseline. */
  priorYearActualSpend?: number | null
  /** Optional: evaluation period identifier for logs / true-up tracking. */
  periodLabel?: string | null
}

// ─── Config types (discriminated union) ────────────────────────

export interface SpendRebateConfig {
  type: "SPEND_REBATE"
  method: TierMethod
  boundaryRule: TierBoundaryRule
  tiers: RebateTier[]
  spendBasis: SpendBasis
  baselineType: BaselineType
  negotiatedBaseline?: number | null
  growthOnly?: boolean
  /** When spendBasis is REFERENCE_NUMBER, only these refs are eligible. */
  referenceNumbers?: string[]
  /** When spendBasis is PRODUCT_CATEGORY, only this category is eligible. */
  productCategory?: string | null
  /** When spendBasis is MULTI_CATEGORY, only these categories are eligible. */
  categories?: string[]
}

export interface VolumeRebateConfig {
  type: "VOLUME_REBATE"
  method: TierMethod
  boundaryRule: TierBoundaryRule
  /** Tier thresholds in CPT occurrences (not dollars). */
  tiers: RebateTier[]
  /** CPT codes whose occurrences count toward this rebate. */
  cptCodes: string[]
  baselineType: BaselineType
  /** In occurrences (not dollars). */
  negotiatedBaseline?: number | null
  growthOnly?: boolean
  /** When set, rebate = occurrences × fixedRebatePerOccurrence (no tier lookup). */
  fixedRebatePerOccurrence?: number | null
}

export interface TierPriceReductionConfig {
  type: "TIER_PRICE_REDUCTION"
  boundaryRule: TierBoundaryRule
  /** Tiers use thresholdMin = spend trigger; rebateValue is ignored — use reducedPrice or priceReductionPercent. */
  tiers: RebateTier[]
  spendBasis: SpendBasis
  /** When RETROACTIVE, reduction applies to all purchases in-period. */
  trigger: PriceReductionTrigger
  referenceNumbers?: string[]
  productCategory?: string | null
  categories?: string[]
}

export interface MarketShareRebateConfig {
  type: "MARKET_SHARE_REBATE"
  method: TierMethod
  boundaryRule: TierBoundaryRule
  /** Thresholds in market-share percent (e.g. 40 = 40%). */
  tiers: RebateTier[]
  /** Optional: restrict to a specific vendor when sharing is tracked cross-vendor. */
  marketShareVendorId?: string | null
  /** Optional: restrict to a specific category for share calculations. */
  marketShareCategory?: string | null
}

export interface MarketSharePriceReductionConfig {
  type: "MARKET_SHARE_PRICE_REDUCTION"
  boundaryRule: TierBoundaryRule
  tiers: RebateTier[]
  trigger: PriceReductionTrigger
  marketShareCategory?: string | null
}

export interface CapitatedConfig {
  type: "CAPITATED"
  /** Purchases for these reference numbers count toward the capitated group. */
  groupedReferenceNumbers: string[]
  /** Per-period spend cap. */
  periodCap: number
  /** Optional embedded sub-engine (evaluated on capped eligibleSpend only). */
  embeddedRebate?:
    | SpendRebateConfig
    | TierPriceReductionConfig
    | null
}

export interface CarveOutLineConfig {
  referenceNumber: string
  rateType: CarveOutRateType
  /** For PERCENT_OF_SPEND: decimal (0.05 = 5%). */
  rebatePercent?: number | null
  /** For FIXED_PER_UNIT: dollars per unit. */
  rebatePerUnit?: number | null
}

export interface CarveOutConfig {
  type: "CARVE_OUT"
  lines: CarveOutLineConfig[]
}

export interface TieInCapitalConfig {
  type: "TIE_IN_CAPITAL"
  /** Upfront capital cost amortized by the rebate stream. */
  capitalCost: number
  /** Annual interest rate (decimal: 0.05 = 5%). */
  interestRate: number
  /** Total repayment term in months. */
  termMonths: number
  /** Cadence of evaluation ("monthly" | "quarterly" | "annual"). */
  period: "monthly" | "quarterly" | "annual"
  shortfallHandling: TrueUpShortfallHandling
  /** Nested rebate config used to compute the earning stream. */
  rebateEngine:
    | SpendRebateConfig
    | VolumeRebateConfig
    | CarveOutConfig
    | MarketShareRebateConfig
}

export type RebateConfig =
  | SpendRebateConfig
  | VolumeRebateConfig
  | TierPriceReductionConfig
  | MarketShareRebateConfig
  | MarketSharePriceReductionConfig
  | CapitatedConfig
  | CarveOutConfig
  | TieInCapitalConfig

// ─── Result shapes ─────────────────────────────────────────────

export interface TierResult {
  tier: RebateTier
  thresholdReached: number
  rebateAmount: number
  /** In original units (dollars or occurrences). */
  amountToNextTier: number | null
  /** When marginal: per-bracket spend and rebate. */
  bracketBreakdown?: Array<{
    tierNumber: number
    bracketSpend: number
    bracketRate: number
    bracketRebate: number
  }>
}

export interface PriceReductionLineResult {
  referenceNumber: string
  purchaseDate: Date
  quantity: number
  originalUnitPrice: number
  effectiveUnitPrice: number
  totalLineReduction: number
}

export interface CarveOutLineResult {
  referenceNumber: string
  rateType: CarveOutRateType
  totalSpend: number
  totalUnits: number
  lineRebate: number
  warning?: string
}

export interface AmortizationEntry {
  periodNumber: number
  openingBalance: number
  interestCharge: number
  principalDue: number
  amortizationDue: number
  closingBalance: number
}

export interface RebateResult {
  type: RebateType
  rebateEarned: number
  /** For price-reduction types; 0 otherwise. */
  priceReductionValue: number
  /** For capitated types; min(groupSpend, cap). */
  eligibleSpend: number
  /** When applicable — tier achieved during this evaluation. */
  tierResult?: TierResult | null
  /** For price-reduction types — per-line breakdown. */
  priceReductionLines?: PriceReductionLineResult[]
  /** For carve-out types — per-line breakdown. */
  carveOutLines?: CarveOutLineResult[]
  /** For tie-in capital types — the schedule row evaluated this period. */
  amortizationEntry?: AmortizationEntry | null
  /**
   * [A10] Signed true-up vs scheduled amortization.
   *   > 0 → facility owes MORE (shortfall);
   *   < 0 → facility over-accrued (credit);
   *   = 0 → exact.
   */
  trueUpAdjustment: number
  /** Diagnostic warnings — non-fatal. */
  warnings: string[]
  /** Fatal errors (no computation possible) — engine returns zero-rebate result with these populated. */
  errors: string[]
  /** Echoes the caller's period label for downstream logging. */
  periodLabel?: string | null
}

// ─── Engine options ─────────────────────────────────────────────

export interface EngineOptions {
  /** When true, log every bracket calculation (debug only). */
  verbose?: boolean
  /** When provided, echoed in the result for downstream tracing. */
  periodLabel?: string | null
}

/** Helper: build a zero-rebate result shell. */
export function zeroResult(type: RebateType, periodLabel?: string | null): RebateResult {
  return {
    type,
    rebateEarned: 0,
    priceReductionValue: 0,
    eligibleSpend: 0,
    tierResult: null,
    trueUpAdjustment: 0,
    warnings: [],
    errors: [],
    periodLabel: periodLabel ?? null,
  }
}
