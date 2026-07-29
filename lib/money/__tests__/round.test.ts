/**
 * Canonical money rounding — the cases float gets wrong.
 */

import { describe, it, expect } from "vitest"
import { roundToCents, roundTo, sumToCents } from "../round"

describe("roundToCents fixes the half-cent boundary", () => {
  it.each([
    [1.005, 1.01],
    [1.015, 1.02],
    [8.165, 8.17],
    [0.015, 0.02],
    [0.045, 0.05],
    [0.155, 0.16],
    [1234.565, 1234.57],
    [2.675, 2.68], // the textbook float example
  ])("%s -> %s", (input, expected) => {
    expect(roundToCents(input)).toBe(expected)
  })

  it("disagrees with Math.round(x*100)/100 exactly where float is wrong", () => {
    // 1.005 is the canonical case: float64 stores it just under, so
    // multiplying by 100 yields 100.49999999999999 and Math.round takes it down.
    expect(Math.round(1.005 * 100) / 100).toBe(1)
    expect(roundToCents(1.005)).toBe(1.01)
  })

  it("is right on a large sweep of half-cent boundaries", () => {
    let disagreements = 0
    for (let cents = 1; cents <= 20000; cents++) {
      const v = cents / 100 + 0.005
      if (roundToCents(v) !== Math.round(v * 100) / 100) disagreements++
    }
    // The old idiom is wrong often enough that this is not a rounding-mode
    // quibble — it is a systematic one-cent under-statement.
    expect(disagreements).toBeGreaterThan(1000)
  })
})

describe("roundToCents leaves already-exact values alone", () => {
  it.each([0, 1, 100.25, 0.01, 999999.99, -0.01, -100.25])("%s", (v) => {
    expect(roundToCents(v)).toBe(v)
  })
})

describe("sign symmetry", () => {
  it("rounds away from zero in both directions", () => {
    expect(roundToCents(1.005)).toBe(1.01)
    expect(roundToCents(-1.005)).toBe(-1.01)
  })

  it("a credit and its matching debit cannot differ by a cent", () => {
    for (const v of [1.005, 8.165, 0.045, 1234.565]) {
      expect(roundToCents(-v)).toBe(-roundToCents(v))
    }
  })
})

describe("non-finite input never reaches a money column", () => {
  it.each([NaN, Infinity, -Infinity])("%s -> 0", (v) => {
    expect(roundToCents(v)).toBe(0)
    expect(roundTo(v, 4)).toBe(0)
  })
})

describe("roundTo for non-money values", () => {
  it("rounds percentages to 2dp correctly", () => {
    expect(roundTo(12.345, 2)).toBe(12.35)
    expect(roundTo(0.005, 2)).toBe(0.01)
  })

  it("supports other precisions", () => {
    expect(roundTo(1.23456, 4)).toBe(1.2346)
    expect(roundTo(1.5, 0)).toBe(2)
    expect(roundTo(-1.5, 0)).toBe(-2)
  })
})

describe("sumToCents rounds once, at the end", () => {
  it("does not accumulate per-row rounding error", () => {
    // Each addend would round UP on its own; summing first keeps the total
    // consistent with the raw inputs.
    const rows = [0.004, 0.004, 0.004, 0.004, 0.004]
    expect(rows.map(roundToCents).reduce((a, b) => a + b, 0)).toBe(0)
    expect(sumToCents(rows)).toBe(0.02)
  })

  it("matches an exact decimal total on realistic money", () => {
    const rows = [1234.565, 99.995, 0.005, 42.42]
    // 1234.565 + 99.995 + 0.005 + 42.42 = 1376.985 -> 1376.99
    expect(sumToCents(rows)).toBe(1376.99)
  })

  it("ignores non-finite entries rather than poisoning the total", () => {
    expect(sumToCents([1.5, NaN, 2.5, Infinity])).toBe(4)
  })

  it("an empty ledger totals zero", () => {
    expect(sumToCents([])).toBe(0)
  })
})
