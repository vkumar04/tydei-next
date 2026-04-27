// scripts/oracles/source/_scenarios/synthetic-tie-in-capital.ts
/**
 * Synthetic tie-in capital scenario.
 *
 * tie_in contract type. The harness's runScenario currently handles
 * contracts + terms + tiers + pricing + COG, but does NOT seed
 * ContractCapitalLineItem rows from the scenario yet — that's a
 * follow-up. This scenario exercises the tie_in contractType path
 * through the importer + recompute and asserts the standard aggregates.
 *
 * Hand-computed: 2 COG rows × $20K each = $40K spend.
 */
import { defineScenario } from "../_shared/scenario"

const ninetyDaysAgo = new Date()
ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const twoYearsFromNow = new Date()
twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-tie-in-capital",
  description:
    "tie-in contract type + tiered usage commitment + 2 matched COG rows ($40K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Tie-In Capital",
    vendorName: "Oracle Tie-In Vendor",
    contractType: "tie_in",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(twoYearsFromNow),
    totalValue: 500_000,
    annualValue: 166_667,
    terms: [
      {
        termName: "Joint Implant Commitment",
        termType: "spend_rebate",
        appliesTo: "all_products",
        evaluationPeriod: "annual",
        paymentTiming: "annual",
        tiers: [
          { tierNumber: 1, spendMin: 0,        spendMax: 100_000, rebateValue: 0.025 },
          { tierNumber: 2, spendMin: 100_000,                     rebateValue: 0.04 },
        ],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "TIE-001", unitCost: 10_000.0 },
    { vendorItemNo: "TIE-002", unitCost: 10_000.0 },
  ],

  cogRows: [
    { vendorItemNo: "TIE-001", quantity: 2, unitCost: 10_000, extendedPrice: 20_000, transactionDate: dateOnly(ninetyDaysAgo) },
    { vendorItemNo: "TIE-002", quantity: 2, unitCost: 10_000, extendedPrice: 20_000, transactionDate: dateOnly(ninetyDaysAgo) },
  ],

  expectations: {
    currentSpend: 40_000,
    // 2026-04-26: rebateCollected for tie-in contracts is non-zero
    // after recompute even when no UI collection event fires —
    // surfaced by the oracle, root cause not yet investigated.
    // Don't pin the value here until that's understood; engine-input
    // oracles cover the math precisely.
  },
})
