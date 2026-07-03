export interface ProspectiveFacility {
  id: string
  name: string
}

/** Tier-ladder row in the builder. `min`/`max` are in the term's targetType
 *  units — DOLLARS for spend, UNITS for volume, PERCENT (0–100) for market
 *  share (never mix; see the CLAUDE.md market-share type-confusion memory).
 *  `value` is denominated per the term's rebateType. */
export interface ProspectiveTermTier {
  /** UI-only stable row id (CLAUDE.md list-key rule) — minted via
   *  crypto.randomUUID(), STRIPPED at the persist boundary. */
  _uid: string
  min: number
  max?: number
  value: number
}

export interface ProspectiveTerm {
  id: string
  termType: "spend_rebate" | "volume_rebate" | "market_share_rebate" | "price_reduction"
  name: string
  targetType: "spend" | "volume" | "market_share"
  targetValue: number
  /** Flat rebate value, denominated per rebateType (mirrors
   *  ContractTier.rebateValue's per-type semantics): percent of spend when
   *  "percent" (3 = 3%), flat dollars when "fixed", dollars per unit when
   *  "per_unit". Ignored when tiers are present. Field name kept for
   *  persistence round-trip with historic proposals (absent rebateType =
   *  percent). */
  rebatePercent: number
  /** How rebate values (flat + tier) are denominated. */
  rebateType: "percent" | "fixed" | "per_unit"
  tiers: ProspectiveTermTier[]
}

export interface MonthlyUsage {
  month: string
  volume: number
  revenue: number
  avgPrice: number
}

export interface ProposalProduct {
  benchmarkId: string
  productName: string
  refNumber?: string
  proposedPrice: number
  /** The facility's CURRENT price for this item — feeds the Deal Scorer's
   *  Current-price prefill. Preserved through the edit round-trip. */
  currentPrice?: number
  projectedVolume: number
  historicalAvgPrice?: number
  historicalAvgVolume?: number
  costBasis?: number
  monthlyUsage?: MonthlyUsage[]
  fromPricingFile?: boolean
}

export interface NewProposalState {
  facilityId: string
  facilityName: string
  isMultiFacility: boolean
  facilities: ProspectiveFacility[]
  productCategory: string
  productCategories: string[]
  isGrouped: boolean
  groupName: string
  /** Organization division names for grouped proposals (audit L13 —
   *  previously the divisions input clobbered `productCategories`).
   *  Optional so the builder's initial state needn't set it. */
  divisions?: string[]
  contractLength: number
  /** Contract start date (YYYY-MM-DD). Hydrated on edit so re-saving doesn't
   *  reset a saved proposal's start date to today; empty = today on create. */
  startDate?: string
  /** Payment terms — hydrated on edit so re-saving doesn't drop them. */
  paymentTerms?: string
  projectedSpend: number
  projectedVolume: number
  totalOpportunity: number
  terms: ProspectiveTerm[]
  products: ProposalProduct[]
  marketShareCommitment: number
  gpoFee: number
  aiNotes: string
}

/**
 * Output of the rule-based (keyword heuristic) term suggester in
 * file-handlers.ts — NOT AI-generated. Renamed from AiSuggestionsState
 * in the vendor-prospective honesty audit (H1.c).
 */
export interface TermSuggestionsState {
  data: {
    negotiationAdvice?: string[]
    suggestedTerms?: { type: string; description: string; rationale: string }[]
    riskFactors?: string[]
    competitiveStrategy?: string | null
    urgencyAssessment?: string
    dealStrength?: "strong" | "moderate" | "weak"
    recommendedDiscount?: string | null
  } | null
}

export interface FileUploadProgressState {
  isLoading: boolean
  type: "usage" | "pricing" | null
  progress: number
  message: string
}

export const PRODUCT_CATEGORIES = [
  "Biologics",
  "Ortho-Spine",
  "Disposables",
  "Capital Equipment",
  "Instruments",
  "Cardiovascular",
  "General Surgery",
]

/** @deprecated Re-export of the canonical `formatCompactCurrency`; kept so
 *  builder components needn't change their import. */
export { formatCompactCurrency as formatCurrencyShort } from "@/lib/formatting"
