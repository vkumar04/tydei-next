import { describe, it, expect } from "vitest"
import {
  selectBundleBaseRate,
  DEFAULT_BUNDLE_BASE_RATE,
} from "@/lib/contracts/bundle-base-rate"

describe("selectBundleBaseRate (Charles 2026-06-07 — fixed-dollar tier misread as %)", () => {
  it("skips a fixed_rebate top tier (dollars) and falls back to the default", () => {
    // STK-2025-TIE: compliance_rebate term with a $17,500 fixed top tier.
    const res = selectBundleBaseRate([
      { tiers: [{ rebateType: "fixed_rebate", rebateValue: 17500 }] },
      { tiers: [{ rebateType: "fixed_rebate", rebateValue: 12500 }] },
    ])
    expect(res.baseRate).toBe(DEFAULT_BUNDLE_BASE_RATE)
    expect(res.clamped).toBe(false)
    expect(res.rawDisplay).toBeNull()
  })

  it("uses a percent tier and scales the fraction to display %", () => {
    // rebateValue stored as a fraction (0.05 = 5%).
    const res = selectBundleBaseRate([
      { tiers: [{ rebateType: "percent_of_spend", rebateValue: 0.05 }] },
    ])
    expect(res.baseRate).toBe(5)
    expect(res.clamped).toBe(false)
  })

  it("picks the first PERCENT term even when a fixed term comes first", () => {
    const res = selectBundleBaseRate([
      { tiers: [{ rebateType: "fixed_rebate", rebateValue: 17500 }] },
      { tiers: [{ rebateType: "percent_of_spend", rebateValue: 0.03 }] },
    ])
    expect(res.baseRate).toBe(3)
  })

  it("clamps a genuinely out-of-range percent value (spend mis-stored in rebate column)", () => {
    const res = selectBundleBaseRate([
      { tiers: [{ rebateType: "percent_of_spend", rebateValue: 300000 }] },
    ])
    expect(res.baseRate).toBe(100)
    expect(res.clamped).toBe(true)
    expect(res.rawValue).toBe(300000)
  })

  it("clamps a negative percent to 0", () => {
    const res = selectBundleBaseRate([
      { tiers: [{ rebateType: "percent_of_spend", rebateValue: -0.5 }] },
    ])
    expect(res.baseRate).toBe(0)
    expect(res.clamped).toBe(true)
  })

  it("falls back to the default on empty terms", () => {
    expect(selectBundleBaseRate([]).baseRate).toBe(DEFAULT_BUNDLE_BASE_RATE)
  })
})
