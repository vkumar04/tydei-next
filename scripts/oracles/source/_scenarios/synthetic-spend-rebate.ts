// scripts/oracles/source/_scenarios/synthetic-spend-rebate.ts
/**
 * Synthetic spend-rebate scenario.
 *
 * Hand-computed expectations:
 *   - 3 COG rows × $10,000 each = $30,000 trailing spend
 *   - All matched to the contract via ContractPricing on vendorItemNo
 *   - Tier 1 (0-50K): 2% rate
 *   - Lifetime earned: $30,000 × 2% = $600 (single pay period covers
 *     the import window)
 *
 * If the harness wires up correctly:
 *   currentSpend === 30_000
 *   rebateEarnedLifetime depends on accrual timing — not pinned in
 *     this first scenario; engine-input oracles already prove the math.
 *
 * Note: rebateEarnedLifetime depends on payPeriodEnd <= today. The
 * scenario uses transactionDates 90+ days in the past so the accrual
 * period is closed.
 */
import { defineScenario } from "../_shared/scenario"

const ninetyDaysAgo = new Date()
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const oneYearFromNow = new Date()
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)

const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-spend-rebate",
  description:
    "Tiered spend-rebate with 3 matched COG rows. Hand-computed to land in Tier 1.",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Spend Rebate",
    vendorName: "Oracle Test Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(oneYearFromNow),
    totalValue: 100_000,
    annualValue: 50_000,
    terms: [
      {
        termName: "Spend Rebate",
        termType: "spend_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,       spendMax: 50_000,  rebateValue: 0.02 },
          { tierNumber: 2, spendMin: 50_000,  spendMax: 100_000, rebateValue: 0.03 },
          { tierNumber: 3, spendMin: 100_000,                    rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "ORC-001", unitCost: 1_000.0 },
    { vendorItemNo: "ORC-002", unitCost: 1_000.0 },
    { vendorItemNo: "ORC-003", unitCost: 1_000.0 },
  ],

  cogRows: [
    { vendorItemNo: "ORC-001", quantity: 10, unitCost: 1_000, extendedPrice: 10_000, transactionDate: dateOnly(ninetyDaysAgo) },
    { vendorItemNo: "ORC-002", quantity: 10, unitCost: 1_000, extendedPrice: 10_000, transactionDate: dateOnly(ninetyDaysAgo) },
    { vendorItemNo: "ORC-003", quantity: 10, unitCost: 1_000, extendedPrice: 10_000, transactionDate: dateOnly(ninetyDaysAgo) },
  ],

  expectations: {
    currentSpend: 30_000,
    // The recompute pipeline may or may not produce a Rebate row in
    // every test environment depending on accrual timing. The first
    // scenario only pins structural facts.
    rebateCollected: 0,
  },
})
