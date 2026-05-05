/**
 * Dispatcher contract: `calculateRebate(config, periodData)` routes
 * to the correct per-type engine and returns its result unmodified.
 *
 * This is a thin wrapper test — the per-type engines have their own
 * thorough suites (`spend-rebate.test.ts`, `volume-rebate.test.ts`,
 * etc). We just verify the routing.
 */
import { describe, it, expect } from "vitest"
import { calculateRebate } from "../index"
import type {
  CarveOutConfig,
  PeriodData,
  PurchaseRecord,
  SpendRebateConfig,
  VolumeRebateConfig,
} from "../types"

function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-1",
    productCategory: null,
    quantity: 1,
    unitPrice: 100,
    extendedPrice: 100,
    purchaseDate: new Date("2026-01-15T00:00:00Z"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

describe("calculateRebate dispatcher", () => {
  it("routes SPEND_REBATE to calculateSpendRebate", () => {
    const config: SpendRebateConfig = {
      type: "SPEND_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [
        { tierNumber: 1, thresholdMin: 0, thresholdMax: null, rebateValue: 5 },
      ],
      spendBasis: "ALL_SPEND",
      baselineType: "NONE",
    }
    const periodData: PeriodData = {
      purchases: [mkPurchase({ extendedPrice: 1_000 })],
      totalSpend: 1_000,
    }
    const result = calculateRebate(config, periodData)
    expect(result.type).toBe("SPEND_REBATE")
    // 1000 * 5% = 50
    expect(result.rebateEarned).toBe(50)
  })

  it("routes VOLUME_REBATE to calculateVolumeRebate", () => {
    const config: VolumeRebateConfig = {
      type: "VOLUME_REBATE",
      method: "CUMULATIVE",
      boundaryRule: "EXCLUSIVE",
      tiers: [],
      cptCodes: ["99213"],
      baselineType: "NONE",
      fixedRebatePerOccurrence: 25,
    }
    const periodData: PeriodData = {
      purchases: [
        mkPurchase({ cptCode: "99213", caseId: "C1" }),
        mkPurchase({ cptCode: "99213", caseId: "C2" }),
      ],
      totalSpend: 200,
    }
    const result = calculateRebate(config, periodData)
    expect(result.type).toBe("VOLUME_REBATE")
    // 2 occurrences × $25 = $50
    expect(result.rebateEarned).toBe(50)
  })

  it("routes CARVE_OUT to calculateCarveOut", () => {
    const config: CarveOutConfig = {
      type: "CARVE_OUT",
      lines: [
        {
          referenceNumber: "REF-1",
          rateType: "PERCENT_OF_SPEND",
          rebatePercent: 0.05,
        },
      ],
    }
    const periodData: PeriodData = {
      purchases: [mkPurchase({ extendedPrice: 1_000 })],
      totalSpend: 1_000,
    }
    const result = calculateRebate(config, periodData)
    expect(result.type).toBe("CARVE_OUT")
    // $1,000 × 5% = $50
    expect(result.rebateEarned).toBe(50)
  })
})
