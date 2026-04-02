export interface ProspectiveFacility {
  id: string
  name: string
}

export interface ProspectiveTerm {
  id: string
  termType: "spend_rebate" | "volume_rebate" | "market_share_rebate" | "price_reduction"
  name: string
  targetType: "spend" | "volume" | "market_share"
  targetValue: number
  rebatePercent: number
  tiers: { threshold: number; rebatePercent: number }[]
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
  contractLength: number
  projectedSpend: number
  projectedVolume: number
  totalOpportunity: number
  terms: ProspectiveTerm[]
  products: ProposalProduct[]
  marketShareCommitment: number
  gpoFee: number
  aiNotes: string
}

export interface AiSuggestionsState {
  isLoading: boolean
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

export function formatCurrencyShort(value: number) {
  if (isNaN(value) || value === null || value === undefined) return "$0"
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}
