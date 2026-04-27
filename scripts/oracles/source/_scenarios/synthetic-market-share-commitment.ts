// scripts/oracles/source/_scenarios/synthetic-market-share-commitment.ts
/**
 * Synthetic market-share-commitment scenario.
 *
 * market_share term type. The harness doesn't seed
 * marketShareCommitmentByCategory yet — that's a follow-up. This
 * scenario imports a market_share term cleanly and asserts the
 * standard aggregates land. Per-category share assertions come once
 * the harness threads commitment JSON.
 *
 * Hand-computed: 3 COG rows × $8K each = $24K spend in Spine.
 */
import { defineScenario } from "../_shared/scenario"

const fortyFiveDaysAgo = new Date()
fortyFiveDaysAgo.setDate(fortyFiveDaysAgo.getDate() - 45)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const oneYearFromNow = new Date()
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-market-share-commitment",
  description:
    "market_share term + 3 matched COG rows in Spine category ($24K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Market Share Commitment",
    vendorName: "Oracle Market-Share Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(oneYearFromNow),
    totalValue: 80_000,
    annualValue: 40_000,
    terms: [
      {
        termName: "Spine Market Share",
        termType: "market_share",
        appliesTo: "specific_category",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,    rebateValue: 0.02 },
          { tierNumber: 2, spendMin: 50,   rebateValue: 0.03 },
          { tierNumber: 3, spendMin: 75,   rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "MS-001", unitCost: 8_000.0, category: "Spine" },
    { vendorItemNo: "MS-002", unitCost: 8_000.0, category: "Spine" },
    { vendorItemNo: "MS-003", unitCost: 8_000.0, category: "Spine" },
  ],

  cogRows: [
    { vendorItemNo: "MS-001", quantity: 1, unitCost: 8_000, extendedPrice: 8_000, transactionDate: dateOnly(fortyFiveDaysAgo), category: "Spine" },
    { vendorItemNo: "MS-002", quantity: 1, unitCost: 8_000, extendedPrice: 8_000, transactionDate: dateOnly(fortyFiveDaysAgo), category: "Spine" },
    { vendorItemNo: "MS-003", quantity: 1, unitCost: 8_000, extendedPrice: 8_000, transactionDate: dateOnly(fortyFiveDaysAgo), category: "Spine" },
  ],

  expectations: {
    currentSpend: 24_000,
    rebateCollected: 0,
  },
})
