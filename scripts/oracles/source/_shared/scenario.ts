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
}

export interface ScenarioPricingRow {
  vendorItemNo: string
  unitCost: number
  category?: string
  manufacturer?: string
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
