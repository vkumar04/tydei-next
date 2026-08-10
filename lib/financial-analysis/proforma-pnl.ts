/**
 * Steady-state proforma P&L → purchase impact on the owner dividend / DCF.
 *
 * Unlike the ratio model in `prospective-impact-model.ts` (revenue × margin →
 * EBITDA), this resolves a LINE-ITEM operating statement — modeled on the
 * customer's "Steady State Proforma" at 1.2× Medicare — and translates a
 * prospective supply purchase into its effect on Net Operating Income, the
 * annual owner dividend (distributable cash flow), NPV, payback, and
 * enterprise value.
 *
 * Canonical-helper routing (one owner per metric):
 *   - dividend % of NOI/EBITDA .... `dcfPctOfEbitda` (FacilityModelAssumptions)
 *   - NPV of the growing stream ... `discountedCashFlow`
 *   - capital payback ............. `computePaybackAnalysis`
 *   - EV at 10/12/14× ............. `computeEnterpriseValueScenarios`
 *
 * All percent-shaped assumptions are FRACTIONS (0.8, not 80) per the engine
 * units convention; UI converts once at the boundary.
 */

import {
  computeEnterpriseValueScenarios,
  discountedCashFlow,
  DEFAULT_FACILITY_ASSUMPTIONS,
  type EnterpriseValueByMultiple,
  type FacilityModelAssumptions,
} from "./prospective-impact-model"
import { computePaybackAnalysis } from "./payback-analysis"

/** The subset of the facility assumptions the dividend model consumes. */
export type DividendAssumptions = Pick<
  FacilityModelAssumptions,
  "dcfPctOfEbitda" | "discountRatePct" | "cashFlowGrowthPct" | "dcfProjectionYears"
>

export const DEFAULT_DIVIDEND_ASSUMPTIONS: DividendAssumptions = {
  dcfPctOfEbitda: DEFAULT_FACILITY_ASSUMPTIONS.dcfPctOfEbitda,
  discountRatePct: DEFAULT_FACILITY_ASSUMPTIONS.discountRatePct,
  cashFlowGrowthPct: DEFAULT_FACILITY_ASSUMPTIONS.cashFlowGrowthPct,
  dcfProjectionYears: DEFAULT_FACILITY_ASSUMPTIONS.dcfProjectionYears,
}

/**
 * The full facility P&L, one field per line on the Steady State Proforma.
 * `medicalSupplies` is the only line a supply purchase moves directly; every
 * other line is captured so the whole statement can be entered per facility.
 * All figures are annual dollars.
 */
export interface ProformaLineItems {
  // Revenue
  standardBillingRevenue: number
  /** Payer discount off gross charges, entered as a positive number. */
  contractualAdjustment: number
  // Variable expenses
  salaryBenefits: number
  medicalSupplies: number
  smallEquipment: number
  officeExpenses: number
  legal: number
  computerServices: number
  managementFees: number
  billingCollection: number
  otherOutsideServices: number
  // Fixed expenses
  insurance: number
  administrative: number
  rentTiUtilities: number
  otherFacility: number
  repairsMaintenance: number
  propTax: number
  stateTaxes: number
  softwareMaintenance: number
  equipRentInterestOther: number
  // Volume
  caseVolume: number
}

/** Seeded from the customer's Steady State Proforma at 1.2× Medicare. */
export const DEFAULT_PROFORMA_LINE_ITEMS: ProformaLineItems = {
  standardBillingRevenue: 267_441_411,
  contractualAdjustment: 235_348_442,
  salaryBenefits: 2_987_260,
  medicalSupplies: 12_316_248,
  smallEquipment: 6_000,
  officeExpenses: 12_000,
  legal: 6_000,
  computerServices: 33_600,
  managementFees: 962_789,
  billingCollection: 962_789,
  otherOutsideServices: 154_000,
  insurance: 60_000,
  administrative: 52_800,
  rentTiUtilities: 1_095_996,
  otherFacility: 60_540,
  repairsMaintenance: 36_000,
  propTax: 68_400,
  stateTaxes: 0,
  softwareMaintenance: 66_000,
  equipRentInterestOther: 747_084,
  caseVolume: 5_200,
}

/** Sum of variable-expense lines other than medical supplies. */
export function otherVariableTotal(li: ProformaLineItems): number {
  return (
    li.salaryBenefits +
    li.smallEquipment +
    li.officeExpenses +
    li.legal +
    li.computerServices +
    li.managementFees +
    li.billingCollection +
    li.otherOutsideServices
  )
}

/** Sum of all fixed-expense lines. */
export function fixedTotal(li: ProformaLineItems): number {
  return (
    li.insurance +
    li.administrative +
    li.rentTiUtilities +
    li.otherFacility +
    li.repairsMaintenance +
    li.propTax +
    li.stateTaxes +
    li.softwareMaintenance +
    li.equipRentInterestOther
  )
}

/**
 * The collapsed aggregate the impact math runs on: only the lines a supply
 * purchase can move are broken out; the rest roll into `otherVariableExpense`
 * and `fixedExpenses`.
 */
export interface ProformaPnL {
  standardBillingRevenue: number
  contractualAdjustment: number
  medicalSupplyExpense: number
  otherVariableExpense: number
  fixedExpenses: number
  caseVolume: number
}

export function lineItemsToProforma(li: ProformaLineItems): ProformaPnL {
  return {
    standardBillingRevenue: li.standardBillingRevenue,
    contractualAdjustment: li.contractualAdjustment,
    medicalSupplyExpense: li.medicalSupplies,
    otherVariableExpense: otherVariableTotal(li),
    fixedExpenses: fixedTotal(li),
    caseVolume: li.caseVolume,
  }
}

/** A fully-resolved P&L with every derived total and per-case figure. */
export interface ResolvedPnL {
  standardBillingRevenue: number
  contractualAdjustment: number
  totalRevenue: number
  medicalSupplyExpense: number
  otherVariableExpense: number
  totalVariableExpense: number
  fixedExpenses: number
  netOperatingIncome: number
  caseVolume: number
  // Per-case economics — these drive the incremental math.
  revenuePerCase: number
  supplyPerCase: number
  otherVariablePerCase: number
  contributionMarginPerCase: number
  noiMarginPct: number
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function resolvePnL(p: ProformaPnL): ResolvedPnL {
  const totalRevenue = p.standardBillingRevenue - p.contractualAdjustment
  const totalVariableExpense = p.medicalSupplyExpense + p.otherVariableExpense
  const netOperatingIncome =
    totalRevenue - totalVariableExpense - p.fixedExpenses
  const cv = p.caseVolume || 1
  const revenuePerCase = totalRevenue / cv
  const supplyPerCase = p.medicalSupplyExpense / cv
  const otherVariablePerCase = p.otherVariableExpense / cv
  return {
    standardBillingRevenue: round(p.standardBillingRevenue),
    contractualAdjustment: round(p.contractualAdjustment),
    totalRevenue: round(totalRevenue),
    medicalSupplyExpense: round(p.medicalSupplyExpense),
    otherVariableExpense: round(p.otherVariableExpense),
    totalVariableExpense: round(totalVariableExpense),
    fixedExpenses: round(p.fixedExpenses),
    netOperatingIncome: round(netOperatingIncome),
    caseVolume: p.caseVolume,
    revenuePerCase: round(revenuePerCase),
    supplyPerCase: round(supplyPerCase),
    otherVariablePerCase: round(otherVariablePerCase),
    contributionMarginPerCase: round(
      revenuePerCase - supplyPerCase - otherVariablePerCase,
    ),
    noiMarginPct:
      totalRevenue > 0 ? round((netOperatingIncome / totalRevenue) * 100) : 0,
  }
}

/**
 * A prospective purchase, described from the vendor's proposal. Positive
 * supply numbers mean the facility pays MORE; negatives mean savings.
 */
export interface PurchaseScenario {
  productName: string
  /** Change in supply cost per affected case, $ (negative = savings). */
  supplyCostDeltaPerCase: number
  /** Existing cases/year using this product. Explicit: 0 means zero cases
   *  (the v0 engine's "0 = whole book" default silently modeled 5,200 cases
   *  while the UI displayed 0 — deliberately dropped). */
  affectedCases: number
  /** Net new cases/year the product enables (e.g. robot throughput). */
  incrementalCases: number
  /** Change in net revenue per affected case, $ (acuity / mix shift). */
  revenueDeltaPerCase: number
  /** One-time capital outlay (robot / console / equipment), $. */
  capitalOutlay: number
  /** New recurring annual cost (service, lease, warranty), $. */
  recurringAnnualCost: number
  /**
   * Net reimbursement per incremental case, $ (Medicare rate × facility % of
   * Medicare). When DEFINED, new cases bill at exactly this rate — including
   * $0 (packaged add-on codes carry no separate ASC payment). Undefined =
   * fall back to the facility's blended revenue-per-case.
   */
  caseReimbursement?: number
}

export const EMPTY_PURCHASE_SCENARIO: PurchaseScenario = {
  productName: "Proposed purchase",
  supplyCostDeltaPerCase: 0,
  affectedCases: 0,
  incrementalCases: 0,
  revenueDeltaPerCase: 0,
  capitalOutlay: 0,
  recurringAnnualCost: 0,
}

export type DividendVerdict = "accretive" | "dilutive" | "neutral"

export interface DividendEvScenario extends EnterpriseValueByMultiple {
  /** ΔEV at this multiple minus the one-time capital outlay. */
  incrementalEvNetOfCapital: number
}

export interface PurchaseDividendImpact {
  before: ResolvedPnL
  after: ResolvedPnL
  noiImpact: number
  /** EBITDA ≈ NOI for this steady-state proforma. */
  ebitdaImpact: number
  annualDividendBefore: number
  annualDividendAfter: number
  annualDividendImpact: number
  /** NPV of the incremental dividend stream, net of the capital outlay. */
  netPresentValue: number
  /** Simple payback on the capital outlay (null = no outlay or no return). */
  paybackYears: number | null
  capitalOutlay: number
  evScenarios: DividendEvScenario[]
  verdict: DividendVerdict
  assumptions: DividendAssumptions
}

/**
 * Translate a prospective purchase into its effect on the facility's NOI,
 * annual dividend, NPV, payback, and enterprise value — the "does this
 * purchase help or hurt the dividend?" report.
 */
export function computePurchaseDividendImpact(
  proforma: ProformaPnL,
  purchase: PurchaseScenario,
  assumptions: DividendAssumptions = DEFAULT_DIVIDEND_ASSUMPTIONS,
): PurchaseDividendImpact {
  const before = resolvePnL(proforma)

  const affected = purchase.affectedCases
  const inc = purchase.incrementalCases

  // Revenue per incremental case: the category's Medicare-based reimbursement
  // when provided (even $0 — the UI card and the engine must agree),
  // otherwise the facility's blended average.
  const incrementalRevPerCase =
    purchase.caseReimbursement !== undefined &&
    Number.isFinite(purchase.caseReimbursement) &&
    purchase.caseReimbursement >= 0
      ? purchase.caseReimbursement
      : before.revenuePerCase

  const newTotalRevenue =
    before.totalRevenue +
    purchase.revenueDeltaPerCase * affected +
    inc * (incrementalRevPerCase + purchase.revenueDeltaPerCase)

  // Supply: per-case delta on affected cases + full (base + delta) supply
  // cost for each incremental case.
  const newMedicalSupply =
    before.medicalSupplyExpense +
    purchase.supplyCostDeltaPerCase * affected +
    inc * (before.supplyPerCase + purchase.supplyCostDeltaPerCase)

  // Other variable scales with the incremental cases only.
  const newOtherVariable =
    before.otherVariableExpense + inc * before.otherVariablePerCase

  // Recurring cost lands in fixed expenses.
  const newFixed = before.fixedExpenses + purchase.recurringAnnualCost

  // Re-express revenue keeping the contractual adjustment constant so the
  // resolved "after" statement reconciles to newTotalRevenue.
  const after = resolvePnL({
    standardBillingRevenue: newTotalRevenue + proforma.contractualAdjustment,
    contractualAdjustment: proforma.contractualAdjustment,
    medicalSupplyExpense: newMedicalSupply,
    otherVariableExpense: newOtherVariable,
    fixedExpenses: newFixed,
    caseVolume: before.caseVolume + inc,
  })

  const noiImpact = after.netOperatingIncome - before.netOperatingIncome
  const ebitdaImpact = noiImpact

  const annualDividendBefore =
    before.netOperatingIncome * assumptions.dcfPctOfEbitda
  const annualDividendAfter =
    after.netOperatingIncome * assumptions.dcfPctOfEbitda
  const annualDividendImpact = annualDividendAfter - annualDividendBefore

  const netPresentValue =
    discountedCashFlow(
      annualDividendImpact,
      assumptions.dcfProjectionYears,
      assumptions.discountRatePct,
      assumptions.cashFlowGrowthPct,
    ) - purchase.capitalOutlay

  // Simple payback on the pre-distribution incremental NOI (full cash
  // generated). Single scenario — no conservative/aggressive spread here.
  const paybackYears =
    purchase.capitalOutlay > 0
      ? computePaybackAnalysis({
          investmentCost: purchase.capitalOutlay,
          expectedAnnualBenefit: noiImpact,
          conservativeFactor: 1,
          aggressiveFactor: 1,
        }).scenarios.find((s) => s.scenario === "expected")?.paybackYears ??
        null
      : null

  const evScenarios: DividendEvScenario[] = computeEnterpriseValueScenarios(
    before.netOperatingIncome,
    ebitdaImpact,
  ).map((s) => ({
    ...s,
    incrementalEvNetOfCapital: round(s.incrementalEv - purchase.capitalOutlay),
  }))

  const verdict: DividendVerdict =
    Math.abs(annualDividendImpact) < 1
      ? "neutral"
      : annualDividendImpact > 0
        ? "accretive"
        : "dilutive"

  return {
    before,
    after,
    noiImpact: round(noiImpact),
    ebitdaImpact: round(ebitdaImpact),
    annualDividendBefore: round(annualDividendBefore),
    annualDividendAfter: round(annualDividendAfter),
    annualDividendImpact: round(annualDividendImpact),
    netPresentValue: round(netPresentValue),
    paybackYears,
    capitalOutlay: round(purchase.capitalOutlay),
    evScenarios,
    verdict,
    assumptions,
  }
}
