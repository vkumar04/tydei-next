import { describe, it, expect } from "vitest"
import {
  computeNetRebate,
  sumNetRebate,
} from "@/lib/contracts/admin-fee"

describe("computeNetRebate (roadmap track 4 — GPO admin fee)", () => {
  it("no admin fee → net equals gross", () => {
    const r = computeNetRebate({ gross: 100_000, adminFeePercent: null })
    expect(r).toEqual({
      gross: 100_000,
      adminFee: 0,
      net: 100_000,
      appliedRate: 0,
    })
  })

  it("undefined admin fee is also null-behavior", () => {
    const r = computeNetRebate({ gross: 100_000 })
    expect(r.net).toBe(100_000)
    expect(r.adminFee).toBe(0)
  })

  it("zero admin fee → net equals gross", () => {
    const r = computeNetRebate({ gross: 100_000, adminFeePercent: 0 })
    expect(r.net).toBe(100_000)
  })

  it("3% admin fee on $100k → $3k fee, $97k net", () => {
    const r = computeNetRebate({ gross: 100_000, adminFeePercent: 0.03 })
    expect(r.gross).toBe(100_000)
    expect(r.adminFee).toBe(3_000)
    expect(r.net).toBe(97_000)
    expect(r.appliedRate).toBe(0.03)
  })

  it("negative admin fee is clamped to zero (GPO can't pay facility)", () => {
    const r = computeNetRebate({ gross: 100_000, adminFeePercent: -0.05 })
    expect(r.adminFee).toBe(0)
    expect(r.net).toBe(100_000)
  })

  it("negative gross (chargeback) passes through without net-out", () => {
    // Reversal / chargeback shouldn't cause the GPO to refund its fee —
    // that's a separate contract clause. Pass gross through unchanged,
    // no admin fee deducted.
    const r = computeNetRebate({ gross: -5_000, adminFeePercent: 0.03 })
    expect(r.gross).toBe(-5_000)
    expect(r.adminFee).toBe(0)
    expect(r.net).toBe(-5_000)
  })

  it("non-finite gross treated as 0", () => {
    const r = computeNetRebate({ gross: Number.NaN, adminFeePercent: 0.03 })
    expect(r.gross).toBe(0)
    expect(r.net).toBe(0)
  })
})

describe("sumNetRebate", () => {
  it("aggregates gross + adminFee + net across rows", () => {
    const r = sumNetRebate([
      { gross: 100_000, adminFeePercent: 0.03 }, // 3000 fee, 97000 net
      { gross: 50_000, adminFeePercent: 0.02 }, //  1000 fee, 49000 net
      { gross: 20_000, adminFeePercent: null }, //     0 fee, 20000 net
    ])
    expect(r.gross).toBe(170_000)
    expect(r.adminFee).toBe(4_000)
    expect(r.net).toBe(166_000)
    // Effective blended rate across all rows.
    expect(r.appliedRate).toBeCloseTo(4_000 / 170_000, 6)
  })

  it("empty array → all zeros", () => {
    const r = sumNetRebate([])
    expect(r).toEqual({ gross: 0, adminFee: 0, net: 0, appliedRate: 0 })
  })

  it("all-zero gross → appliedRate is 0 (no div-by-zero)", () => {
    const r = sumNetRebate([{ gross: 0, adminFeePercent: 0.03 }])
    expect(r.appliedRate).toBe(0)
  })
})
