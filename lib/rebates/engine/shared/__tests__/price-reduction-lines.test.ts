import { describe, it, expect } from "vitest"
import { computePriceReductionLines } from "../price-reduction-lines"
import type { PurchaseRecord, RebateTier } from "../../types"

function mkPurchase(overrides: Partial<PurchaseRecord>): PurchaseRecord {
  return {
    referenceNumber: "REF-DEFAULT",
    productCategory: null,
    quantity: 1,
    unitPrice: 100,
    extendedPrice: 100,
    purchaseDate: new Date("2026-01-15"),
    cptCode: null,
    caseId: null,
    ...overrides,
  }
}

describe("computePriceReductionLines — [A7] per-line breakdown", () => {
  it("tier with reducedPrice=80 + mixed-price purchases → per-line reductions", () => {
    const tier: RebateTier = {
      tierNumber: 1,
      thresholdMin: 0,
      thresholdMax: null,
      rebateValue: 0,
      reducedPrice: 80,
    }
    const purchases = [
      mkPurchase({
        referenceNumber: "REF-A",
        unitPrice: 100,
        quantity: 5,
        extendedPrice: 500,
      }),
      mkPurchase({
        referenceNumber: "REF-B",
        unitPrice: 150,
        quantity: 5,
        extendedPrice: 750,
      }),
    ]
    const lines = computePriceReductionLines(purchases, tier)

    expect(lines).toHaveLength(2)

    // Line 1: original 100, effective 80, reduction per unit 20 × 5 = 100
    expect(lines[0]).toMatchObject({
      referenceNumber: "REF-A",
      originalUnitPrice: 100,
      effectiveUnitPrice: 80,
      quantity: 5,
      totalLineReduction: 100,
    })

    // Line 2: original 150, effective 80, reduction per unit 70 × 5 = 350
    expect(lines[1]).toMatchObject({
      referenceNumber: "REF-B",
      originalUnitPrice: 150,
      effectiveUnitPrice: 80,
      quantity: 5,
      totalLineReduction: 350,
    })
  })

  it("tier with priceReductionPercent=0.1 → 10% off each unit price", () => {
    const tier: RebateTier = {
      tierNumber: 1,
      thresholdMin: 0,
      thresholdMax: null,
      rebateValue: 0,
      priceReductionPercent: 0.1,
    }
    const purchases = [
      mkPurchase({
        referenceNumber: "REF-C",
        unitPrice: 100,
        quantity: 3,
        extendedPrice: 300,
      }),
    ]
    const lines = computePriceReductionLines(purchases, tier)

    expect(lines).toHaveLength(1)
    expect(lines[0]?.originalUnitPrice).toBe(100)
    expect(lines[0]?.effectiveUnitPrice).toBeCloseTo(90, 10)
    expect(lines[0]?.totalLineReduction).toBeCloseTo(30, 10)
  })

  it("tier with neither reducedPrice nor priceReductionPercent → effective=original, reduction=0", () => {
    const tier: RebateTier = {
      tierNumber: 1,
      thresholdMin: 0,
      thresholdMax: null,
      rebateValue: 0,
    }
    const purchases = [
      mkPurchase({ unitPrice: 100, quantity: 4, extendedPrice: 400 }),
    ]
    const lines = computePriceReductionLines(purchases, tier)

    expect(lines).toHaveLength(1)
    expect(lines[0]?.originalUnitPrice).toBe(100)
    expect(lines[0]?.effectiveUnitPrice).toBe(100)
    expect(lines[0]?.totalLineReduction).toBe(0)
  })

  it("preserves referenceNumber, purchaseDate, and quantity per line", () => {
    const tier: RebateTier = {
      tierNumber: 1,
      thresholdMin: 0,
      thresholdMax: null,
      rebateValue: 0,
      reducedPrice: 50,
    }
    const date = new Date("2026-03-20")
    const purchases = [
      mkPurchase({
        referenceNumber: "SPECIFIC-REF",
        unitPrice: 100,
        quantity: 7,
        extendedPrice: 700,
        purchaseDate: date,
      }),
    ]
    const lines = computePriceReductionLines(purchases, tier)

    expect(lines[0]?.referenceNumber).toBe("SPECIFIC-REF")
    expect(lines[0]?.purchaseDate).toBe(date)
    expect(lines[0]?.quantity).toBe(7)
  })

  it("empty purchases → empty line array", () => {
    const tier: RebateTier = {
      tierNumber: 1,
      thresholdMin: 0,
      thresholdMax: null,
      rebateValue: 0,
      reducedPrice: 80,
    }
    const lines = computePriceReductionLines([], tier)
    expect(lines).toEqual([])
  })
})
