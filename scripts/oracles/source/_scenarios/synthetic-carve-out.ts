// scripts/oracles/source/_scenarios/synthetic-carve-out.ts
/**
 * Synthetic carve-out scenario.
 *
 * carve_out term type. Per-line `carveOutPercent` on ContractPricing
 * isn't threaded by the harness yet — that's a follow-up. This
 * scenario exercises the carve_out term import + recompute path with
 * a flat tier rate so the structural aggregates land predictably.
 *
 * Hand-computed: 4 COG rows × $5K = $20K spend.
 */
import { defineScenario } from "../_shared/scenario"

const sixtyDaysAgo = new Date()
sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60)
const oneYearAgo = new Date()
oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)
const oneYearFromNow = new Date()
oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1)
const dateOnly = (d: Date) => d.toISOString().slice(0, 10)

export default defineScenario({
  name: "synthetic-carve-out",
  description: "carve_out term + 4 matched COG rows ($20K).",

  facilityName: "Lighthouse Surgical Center",

  contract: {
    contractNumberSuffix: "001",
    name: "Synthetic Oracle — Carve-Out",
    vendorName: "Oracle Carve-Out Vendor",
    contractType: "usage",
    status: "active",
    effectiveDate: dateOnly(oneYearAgo),
    expirationDate: dateOnly(oneYearFromNow),
    totalValue: 60_000,
    annualValue: 30_000,
    terms: [
      {
        termName: "Carve-Out",
        termType: "carve_out",
        appliesTo: "all_products",
        evaluationPeriod: "quarterly",
        paymentTiming: "quarterly",
        tiers: [{ tierNumber: 1, spendMin: 0, rebateValue: 0.05 }],
      },
    ],
  },

  pricingRows: [
    { vendorItemNo: "CO-001", unitCost: 1_250.0 },
    { vendorItemNo: "CO-002", unitCost: 1_250.0 },
    { vendorItemNo: "CO-003", unitCost: 1_250.0 },
    { vendorItemNo: "CO-004", unitCost: 1_250.0 },
  ],

  cogRows: [
    { vendorItemNo: "CO-001", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
    { vendorItemNo: "CO-002", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
    { vendorItemNo: "CO-003", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
    { vendorItemNo: "CO-004", quantity: 4, unitCost: 1_250, extendedPrice: 5_000, transactionDate: dateOnly(sixtyDaysAgo) },
  ],

  expectations: {
    currentSpend: 20_000,
    rebateCollected: 0,
  },
})
