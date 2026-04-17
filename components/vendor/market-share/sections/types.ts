/**
 * Shared shapes for market-share section components. The main client
 * pre-computes these from the raw query response so each section is
 * a pure view of already-derived data.
 */

export interface CategoryRow {
  category: string
  yourSpend: number
  totalMarket: number
  sharePct: number
  trend: "up" | "down" | "flat"
}

export interface FacilityRow {
  facility: string
  yourSpend: number
  totalSpend: number
  sharePct: number
}

export interface SimilarPair {
  a: string
  b: string
  similarity: number
}

export interface MarketShareStats {
  totalCategories: number
  overallSharePct: number
  activeContracts: number
  revenueRank: number
  totalVendorSpend: number
  totalMarketSpend: number
}
