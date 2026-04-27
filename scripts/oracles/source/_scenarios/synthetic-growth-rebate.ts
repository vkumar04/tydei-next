// scripts/oracles/source/_scenarios/synthetic-growth-rebate.ts
/**
 * Synthetic growth-rebate scenario.
 *
 * growth_rebate term type. Tier thresholds are growth-pct values
 * vs prior-period baseline. Growth-specific math depends on prior-
 * period data the recompute engine pulls from earlier ContractPeriods,
 * which we don't synthesize here, so expectations are limited to
 * structural aggregates.
 *
 * Hand-computed: 5 COG rows × $4K = $20K spend.
 */
import { defineScenario } from "../_shared/scenario"

const thirtyDaysAgo = new Date()
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
const eighteenMonthsAgo = new Date()
eighteenMonthsAgo.setMonth(eighteenMonthsAgo.getMonth() - 18)
const sixMonthsFromNow = new Date()
sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-growth-rebate",
  description: "growth_rebate term + 5 matched COG rows ($20K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Growth Rebate",
    vendorName: "Oracle Growth Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(eighteenMonthsAgo),
    expirationDate: dateOnly(sixMonthsFromNow),
    totalValue: 100_000,
    annualValue: 50_000,
    terms: [
      {
        termName: "YoY Growth",
        termType: "growth_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,    rebateValue: 0.01 },
          { tierNumber: 2, spendMin: 5,    rebateValue: 0.02 },
          { tierNumber: 3, spendMin: 10,   rebateValue: 0.03 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "GR-001", unitCost: 800.0 },
    { vendorItemNo: "GR-002", unitCost: 800.0 },
    { vendorItemNo: "GR-003", unitCost: 800.0 },
    { vendorItemNo: "GR-004", unitCost: 800.0 },
    { vendorItemNo: "GR-005", unitCost: 800.0 },
  ],

  cogRows: [
    { vendorItemNo: "GR-001", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-002", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-003", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-004", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
    { vendorItemNo: "GR-005", quantity: 5, unitCost: 800, extendedPrice: 4_000, transactionDate: dateOnly(thirtyDaysAgo) },
  ],

  expectations: {
    currentSpend: 20_000,
    rebateCollected: 0,
  },
})
