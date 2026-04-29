import { describe, it, expect } from "vitest"
import { enrichCOGRecord, enrichBatch } from "../enrichment"
import type { MatchResult } from "@/lib/contracts/match"

describe("enrichCOGRecord", () => {
  it("maps unknown_vendor to null/false columns", () => {
    const result: MatchResult = { status: "unknown_vendor" }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("unknown_vendor")
    expect(cols.contractId).toBeNull()
    expect(cols.contractPrice).toBeNull()
    expect(cols.isOnContract).toBe(false)
    expect(cols.savingsAmount).toBeNull()
    expect(cols.variancePercent).toBeNull()
  })

  it("maps off_contract_item to null/false columns", () => {
    const result: MatchResult = {
      status: "off_contract_item",
      reason: "no active contract for vendor",
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("off_contract_item")
    expect(cols.isOnContract).toBe(false)
    expect(cols.contractId).toBeNull()
    expect(cols.savingsAmount).toBeNull()
  })

  it("maps out_of_scope to null/false columns", () => {
    const result: MatchResult = {
      status: "out_of_scope",
      reason: "no contract covers this date",
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("out_of_scope")
    expect(cols.isOnContract).toBe(false)
  })

  it("maps on_contract to populated columns with positive savings", () => {
    const result: MatchResult = {
      status: "on_contract",
      contractId: "c-1",
      contractPrice: 100,
      savings: 200,
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 100 })
    expect(cols.matchStatus).toBe("on_contract")
    expect(cols.contractId).toBe("c-1")
    expect(cols.contractPrice).toBe(100)
    expect(cols.isOnContract).toBe(true)
    expect(cols.savingsAmount).toBe(200)
    expect(cols.variancePercent).toBe(0)
  })

  it("Charles 2026-04-29 Bug C: nulls savings when ratio implies kit-vs-component mismatch", () => {
    // AR-8727-42 from Charles's screenshot: extended $37 (qty 8 × ~$4.625),
    // matched against a contract priced ~$123/unit. Algebraic identity:
    //   savings/extended = contractPrice/unitCost - 1
    //   = 123/4.625 - 1 ≈ 25.6
    // Pre-fix this rendered as "+$946 saved" on a $37 line — fictional.
    // Post-fix: variance still surfaces, savings nulls out.
    const result: MatchResult = {
      status: "price_variance",
      contractId: "c-1",
      contractPrice: 123,
      variancePercent: -86.7,
    }
    const cols = enrichCOGRecord(result, { quantity: 8, unitCost: 4.625 })
    expect(cols.matchStatus).toBe("price_variance")
    expect(cols.variancePercent).toBeCloseTo(-86.7, 1)
    expect(cols.savingsAmount).toBeNull()
  })

  it("Charles 2026-04-29 Bug C: keeps savings when ratio is plausible (≤10×)", () => {
    // AR-4541 from same screenshot: extended $342 (qty 1 × $342),
    // matched against contract ~$393. Ratio = 393/342 - 1 ≈ 0.15.
    // Real overpay; should NOT be nulled.
    const result: MatchResult = {
      status: "price_variance",
      contractId: "c-1",
      contractPrice: 393.56,
      variancePercent: -13.1,
    }
    const cols = enrichCOGRecord(result, { quantity: 1, unitCost: 342 })
    expect(cols.savingsAmount).not.toBeNull()
    // (393.56 - 342) × 1 ≈ 51.56
    expect(Number(cols.savingsAmount)).toBeCloseTo(51.56, 1)
  })

  it("maps price_variance to populated columns with positive variancePercent", () => {
    const result: MatchResult = {
      status: "price_variance",
      contractId: "c-1",
      contractPrice: 100,
      variancePercent: 10,
    }
    const cols = enrichCOGRecord(result, { quantity: 10, unitCost: 110 })
    expect(cols.matchStatus).toBe("price_variance")
    expect(cols.contractId).toBe("c-1")
    expect(cols.contractPrice).toBe(100)
    expect(cols.isOnContract).toBe(false) // variance means NOT on contract cleanly
    expect(cols.variancePercent).toBe(10)
    // savingsAmount = (contractPrice - unitCost) × quantity = (100 - 110) × 10 = -100
    // Sign: negative savings = facility overpaid
    expect(cols.savingsAmount).toBe(-100)
  })
})

describe("enrichBatch", () => {
  it("applies enrichment across an array of records preserving order", () => {
    const results: MatchResult[] = [
      { status: "unknown_vendor" },
      { status: "on_contract", contractId: "c-1", contractPrice: 50, savings: 100 },
    ]
    const records = [
      { quantity: 5, unitCost: 50 },
      { quantity: 5, unitCost: 50 },
    ]
    const enriched = enrichBatch(
      results.map((r, i) => ({ result: r, record: records[i]! })),
    )
    expect(enriched).toHaveLength(2)
    expect(enriched[0]!.matchStatus).toBe("unknown_vendor")
    expect(enriched[1]!.matchStatus).toBe("on_contract")
    expect(enriched[1]!.isOnContract).toBe(true)
  })
})
