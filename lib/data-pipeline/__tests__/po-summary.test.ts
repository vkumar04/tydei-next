import { describe, it, expect } from "vitest"
import { summarizePO, summarizePOList } from "../po-summary"

describe("summarizePO", () => {
  it("zero lines → all zeros, percent = 0", () => {
    const r = summarizePO([])
    expect(r).toEqual({
      totalLines: 0,
      onContractLines: 0,
      offContractLines: 0,
      offContractPercent: 0,
      totalSpend: 0,
      onContractSpend: 0,
      offContractSpend: 0,
      totalVariance: 0,
    })
  })

  it("aggregates on-contract + off-contract lines correctly", () => {
    const r = summarizePO([
      { isOnContract: true, extendedPrice: 1000, variance: 0 },
      { isOnContract: true, extendedPrice: 500, variance: null },
      { isOnContract: false, extendedPrice: 250, variance: null },
    ])
    expect(r.totalLines).toBe(3)
    expect(r.onContractLines).toBe(2)
    expect(r.offContractLines).toBe(1)
    expect(r.offContractPercent).toBeCloseTo(33.33, 2)
    expect(r.totalSpend).toBe(1750)
    expect(r.onContractSpend).toBe(1500)
    expect(r.offContractSpend).toBe(250)
  })

  it("sums variance (null values skipped)", () => {
    const r = summarizePO([
      { isOnContract: true, extendedPrice: 1000, variance: 50 },
      { isOnContract: true, extendedPrice: 500, variance: -20 },
      { isOnContract: false, extendedPrice: 250, variance: null },
    ])
    expect(r.totalVariance).toBe(30)
  })

  it("100% off-contract", () => {
    const r = summarizePO([
      { isOnContract: false, extendedPrice: 1000, variance: null },
      { isOnContract: false, extendedPrice: 500, variance: null },
    ])
    expect(r.offContractPercent).toBe(100)
    expect(r.onContractSpend).toBe(0)
  })

  it("100% on-contract", () => {
    const r = summarizePO([
      { isOnContract: true, extendedPrice: 1000, variance: 0 },
    ])
    expect(r.offContractPercent).toBe(0)
    expect(r.offContractSpend).toBe(0)
    expect(r.onContractSpend).toBe(1000)
  })
})

describe("summarizePOList", () => {
  it("empty list → zeros", () => {
    const r = summarizePOList([])
    expect(r).toEqual({
      totalPOs: 0,
      pOsWithOffContractLines: 0,
      totalLines: 0,
      totalOnContractLines: 0,
      totalOffContractLines: 0,
      totalSpend: 0,
      totalOnContractSpend: 0,
      totalOffContractSpend: 0,
    })
  })

  it("aggregates across multiple POs", () => {
    const r = summarizePOList([
      {
        lines: [
          { isOnContract: true, extendedPrice: 1000, variance: 0 },
          { isOnContract: false, extendedPrice: 500, variance: null },
        ],
      },
      {
        lines: [
          { isOnContract: true, extendedPrice: 2000, variance: 0 },
        ],
      },
      {
        lines: [
          { isOnContract: false, extendedPrice: 100, variance: null },
          { isOnContract: false, extendedPrice: 200, variance: null },
        ],
      },
    ])
    expect(r.totalPOs).toBe(3)
    expect(r.pOsWithOffContractLines).toBe(2) // PO1 and PO3
    expect(r.totalLines).toBe(5)
    expect(r.totalOnContractLines).toBe(2)
    expect(r.totalOffContractLines).toBe(3)
    expect(r.totalSpend).toBe(3800)
    expect(r.totalOnContractSpend).toBe(3000)
    expect(r.totalOffContractSpend).toBe(800)
  })

  it("every PO on-contract → pOsWithOffContractLines = 0", () => {
    const r = summarizePOList([
      { lines: [{ isOnContract: true, extendedPrice: 100, variance: 0 }] },
      { lines: [{ isOnContract: true, extendedPrice: 200, variance: 0 }] },
    ])
    expect(r.pOsWithOffContractLines).toBe(0)
  })

  it("empty-lines PO counts towards totalPOs but adds no spend", () => {
    const r = summarizePOList([
      { lines: [] },
      { lines: [{ isOnContract: true, extendedPrice: 100, variance: 0 }] },
    ])
    expect(r.totalPOs).toBe(2)
    expect(r.totalLines).toBe(1)
    expect(r.totalSpend).toBe(100)
  })
})
