// scripts/oracles/source/_shared/scenario.ts
/**
 * Source-level oracle scenario definition.
 *
 * Each scenario provides three layers of input: contract spec, pricing
 * rows, COG rows. The harness drives all three through the real app
 * pipeline and compares the customer-facing aggregates to the
 * scenario's `expectations` block.
 */

export interface ScenarioContractTier {
  tierNumber: number
  spendMin: number
  spendMax?: number
  rebateValue: number
}

export interface ScenarioContractTerm {
  termName: string
  termType: string
  appliesTo?: "all_products" | "specific_category" | "specific_items"
  evaluationPeriod?: string
  paymentTiming?: string
  baselineType?: string
  rebateMethod?: string
  tiers: ScenarioContractTier[]
}

/**
 * Capital line items for tie_in / capital contracts. The harness
 * inserts these as ContractCapitalLineItem rows so the per-asset
 * amortization schedule has data to render.
 */
export interface ScenarioCapitalLineItem {
  description: string
  itemNumber?: string
  serialNumber?: string
  contractTotal: number
  initialSales?: number
  /** Stored as DECIMAL fraction in DB (0.05 = 5%). */
  interestRate?: number
  termMonths: number
  paymentType?: string
  paymentCadence?: string
}

/**
 * Optional per-category market-share commitment overlay.
 *
 * Persisted to Contract.marketShareCommitmentByCategory JSON. Schema
 * accepts `[{category, commitmentPct}, ...]`. The
 * computeCategoryMarketShare helper reads it as the "committed share"
 * line on the per-category card.
 */
export interface ScenarioCategoryCommitment {
  category: string
  commitmentPct: number
}

export interface ScenarioContractSpec {
  /** Suffix appended after `[ORACLE-<scenario-name>]` to keep contract
   *  numbers unique within a scenario family. */
  contractNumberSuffix: string
  name: string
  vendorName: string
  contractType: "usage" | "capital" | "tie_in" | "service" | "pricing_only" | "grouped"
  status?: "active" | "expiring" | "draft"
  effectiveDate: string
  expirationDate: string
  totalValue: number
  annualValue: number
  terms: ScenarioContractTerm[]
  /** Optional capital line items (tie_in / capital). */
  capitalLineItems?: ScenarioCapitalLineItem[]
  /** Optional per-category commitment overlay. */
  marketShareCommitments?: ScenarioCategoryCommitment[]
}

export interface ScenarioPricingRow {
  vendorItemNo: string
  unitCost: number
  category?: string
  manufacturer?: string
  /** Optional per-line carve-out rate (DECIMAL fraction, 0.03 = 3%).
   *  Persisted to ContractPricing.carveOutPercent so the carve_out
   *  recompute path applies a per-SKU rate. */
  carveOutPercent?: number
}

export interface ScenarioCogRow {
  vendorItemNo: string
  quantity: number
  unitCost: number
  extendedPrice: number
  /** ISO date string (YYYY-MM-DD). */
  transactionDate: string
  category?: string
  inventoryNumber?: string
  inventoryDescription?: string
}

export interface ScenarioExpectations {
  /** Lifetime earned rebate from Rebate rows after recompute. */
  rebateEarnedLifetime?: number
  /** Lifetime collected. */
  rebateCollected?: number
  /** Trailing-12mo COG sum at facility. */
  currentSpend?: number
  /** Number of Rebate rows after recompute. */
  rebateRowCount?: number
  /** ContractPeriod row count. */
  contractPeriodCount?: number
}

export interface Scenario {
  name: string
  description: string
  facilityName: string
  contract: ScenarioContractSpec
  pricingRows: ScenarioPricingRow[]
  cogRows: ScenarioCogRow[]
  expectations: ScenarioExpectations
}

export function defineScenario(spec: Scenario): Scenario {
  return spec
}
