import { describe, it, expect } from "vitest"
import { buildTieInAmortizationSchedule } from "../amortization"
import { calculateTieInCapital } from "../tie-in-capital"
import type {
  PeriodData,
  PurchaseRecord,
  SpendRebateConfig,
  TieInCapitalConfig,
} from "../types"

// ─── Helpers ───────────────────────────────────────────────────
function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 0,
    extendedPrice: 0,
    purchaseDate: new Date("2026-02-01T00:00:00Z"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

function mkPeriod(
  purchases: PurchaseRecord[],
  overrides?: Partial<PeriodData>,
): PeriodData {
  return {
    purchases,
    totalSpend: purchases.reduce((a, p) => a + p.extendedPrice, 0),
    ...overrides,
  }
}

// Reusable nested spend-rebate config: 3% flat on ALL_SPEND.
function mkFlatSpendRebate(rate: number): SpendRebateConfig {
  return {
    type: "SPEND_REBATE",
    method: "CUMULATIVE",
    boundaryRule: "EXCLUSIVE",
    tiers: [
      {
        tierNumber: 1,
        thresholdMin: 0,
        thresholdMax: null,
        rebateValue: rate,
      },
    ],
    spendBasis: "ALL_SPEND",
    baselineType: "NONE",
  }
}

describe("calculateTieInCapital — baseline behavior", () => {
  const config: TieInCapitalConfig = {
    type: "TIE_IN_CAPITAL",
    capitalCost: 250_000,
    interestRate: 0.05,
    termMonths: 36,
    period: "quarterly",
    shortfallHandling: "CARRY_FORWARD",
    rebateEngine: mkFlatSpendRebate(3), // 3% of spend
  }

  it("period 1: amortizationEntry matches schedule[0]; rebateEarned comes from sub-engine", () => {
    const purchases = [
      mkPurchase({
        referenceNumber: "A",
        quantity: 1,
        unitPrice: 100_000,
        extendedPrice: 100_000,
      }),
    ]
    const result = calculateTieInCapital(config, mkPeriod(purchases), {
      periodLabel: "2026-Q1",
      periodNumber: 1,
    })

    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
    })

    expect(result.type).toBe("TIE_IN_CAPITAL")
    expect(result.amortizationEntry).toEqual(schedule[0])
    // 3% of $100K = $3K.
    expect(result.rebateEarned).toBeCloseTo(3_000, 6)
    expect(result.eligibleSpend).toBe(100_000)
    expect(result.periodLabel).toBe("2026-Q1")

    // True-up per [A10] = scheduledDue - rebateEarned.
    const scheduledDue = schedule[0]!.amortizationDue
    expect(result.trueUpAdjustment).toBeCloseTo(scheduledDue - 3_000, 6)
  })
})

describe("calculateTieInCapital — shortfall ([A10] positive)", () => {
  it("low rebate → trueUpAdjustment > 0 and a shortfall warning is emitted", () => {
    const config: TieInCapitalConfig = {
      type: "TIE_IN_CAPITAL",
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
      shortfallHandling: "CARRY_FORWARD",
      rebateEngine: mkFlatSpendRebate(1), // 1% → tiny earnings vs amortization
    }

    const purchases = [
      mkPurchase({
        referenceNumber: "A",
        quantity: 1,
        unitPrice: 10_000,
        extendedPrice: 10_000,
      }),
    ]
    const result = calculateTieInCapital(config, mkPeriod(purchases), {
      periodNumber: 1,
    })

    expect(result.trueUpAdjustment).toBeGreaterThan(0)
    expect(
      result.warnings.some((w) => w.includes("carried forward")),
    ).toBe(true)
  })
})

describe("calculateTieInCapital — over-accrual ([A10] negative)", () => {
  it("high rebate → trueUpAdjustment < 0; no shortfall warning", () => {
    const config: TieInCapitalConfig = {
      type: "TIE_IN_CAPITAL",
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
      shortfallHandling: "CARRY_FORWARD",
      rebateEngine: mkFlatSpendRebate(50), // 50% → dramatically over-accrued
    }

    const purchases = [
      mkPurchase({
        referenceNumber: "A",
        quantity: 1,
        unitPrice: 500_000,
        extendedPrice: 500_000,
      }),
    ]
    const result = calculateTieInCapital(config, mkPeriod(purchases), {
      periodNumber: 1,
    })

    expect(result.trueUpAdjustment).toBeLessThan(0)
    expect(
      result.warnings.some(
        (w) => w.includes("carried forward") || w.includes("bill facility"),
      ),
    ).toBe(false)
  })
})

describe("calculateTieInCapital — CARRY_FORWARD across periods", () => {
  it("carriedForwardShortfall adds to scheduledDue on the next period", () => {
    const config: TieInCapitalConfig = {
      type: "TIE_IN_CAPITAL",
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
      shortfallHandling: "CARRY_FORWARD",
      rebateEngine: mkFlatSpendRebate(1),
    }

    const purchases = [
      mkPurchase({
        referenceNumber: "A",
        quantity: 1,
        unitPrice: 10_000,
        extendedPrice: 10_000,
      }),
    ]

    const p1 = calculateTieInCapital(config, mkPeriod(purchases), {
      periodNumber: 1,
    })
    expect(p1.trueUpAdjustment).toBeGreaterThan(0)

    // Caller passes forward the positive shortfall.
    const carried = p1.trueUpAdjustment
    const p2 = calculateTieInCapital(config, mkPeriod(purchases), {
      periodNumber: 2,
      carriedForwardShortfall: carried,
    })

    const schedule = buildTieInAmortizationSchedule({
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
    })

    // Period 2 scheduledDue is amortizationDue + carried; trueUp reflects it.
    const expectedScheduled = schedule[1]!.amortizationDue + carried
    expect(p2.trueUpAdjustment).toBeCloseTo(
      expectedScheduled - p2.rebateEarned,
      6,
    )
    expect(p2.amortizationEntry).toEqual(schedule[1])
  })
})

describe("calculateTieInCapital — BILL_IMMEDIATELY warning text", () => {
  it("emits 'bill facility' warning when shortfall > 0", () => {
    const config: TieInCapitalConfig = {
      type: "TIE_IN_CAPITAL",
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly",
      shortfallHandling: "BILL_IMMEDIATELY",
      rebateEngine: mkFlatSpendRebate(1),
    }

    const purchases = [
      mkPurchase({
        referenceNumber: "A",
        quantity: 1,
        unitPrice: 10_000,
        extendedPrice: 10_000,
      }),
    ]
    const result = calculateTieInCapital(config, mkPeriod(purchases), {
      periodNumber: 1,
    })

    expect(result.trueUpAdjustment).toBeGreaterThan(0)
    expect(
      result.warnings.some((w) => w.includes("bill facility")),
    ).toBe(true)
    expect(
      result.warnings.some((w) => w.includes("carried forward")),
    ).toBe(false)
  })
})

describe("calculateTieInCapital — period overruns schedule", () => {
  it("returns a zero-rebate result with a warning when periodNumber > schedule length", () => {
    const config: TieInCapitalConfig = {
      type: "TIE_IN_CAPITAL",
      capitalCost: 250_000,
      interestRate: 0.05,
      termMonths: 36,
      period: "quarterly", // 12 periods total
      shortfallHandling: "CARRY_FORWARD",
      rebateEngine: mkFlatSpendRebate(3),
    }

    const result = calculateTieInCapital(config, mkPeriod([]), {
      periodNumber: 13,
    })

    expect(result.type).toBe("TIE_IN_CAPITAL")
    expect(result.rebateEarned).toBe(0)
    expect(result.priceReductionValue).toBe(0)
    // zeroResult omits amortizationEntry entirely (undefined).
    expect(result.amortizationEntry == null).toBe(true)
    expect(
      result.warnings.some(
        (w) => w.includes("exceeds schedule length") && w.includes("13"),
      ),
    ).toBe(true)
  })
})
