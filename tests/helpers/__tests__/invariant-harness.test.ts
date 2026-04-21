import { describe, it, expect } from "vitest"
import {
  registerInvariant,
  checkInvariant,
  assertInvariantHolds,
} from "@/tests/helpers/invariant-harness"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import {
  sumEarnedRebatesYTD,
  sumEarnedRebatesLifetime,
} from "@/lib/contracts/rebate-earned-filter"

describe("invariant-harness", () => {
  it("requires at least 2 reducers (otherwise there's nothing to compare)", () => {
    expect(() =>
      registerInvariant({
        name: "single",
        reducers: { canonical: () => 0 },
      }),
    ).toThrow(/at least 2 reducers/)
  })

  it("reports no violations when every reducer agrees", () => {
    const inv = registerInvariant({
      name: "mock",
      reducers: {
        canonical: (n: number) => n * 2,
        alt: (n: number) => n + n,
      },
    })
    const violations = checkInvariant(inv, 5)
    expect(violations).toEqual([])
  })

  it("reports violations with got/expected/delta for each drifting surface", () => {
    const inv = registerInvariant({
      name: "rebate YTD",
      reducers: {
        canonical: (n: number) => n * 2,
        tooHigh: (n: number) => n * 2 + 100,
        tooLow: (n: number) => n * 2 - 50,
        agrees: (n: number) => n + n,
      },
    })
    const violations = checkInvariant(inv, 10)
    expect(violations).toHaveLength(2) // tooHigh + tooLow
    const byName = Object.fromEntries(violations.map((v) => [v.reducerName, v]))
    expect(byName.tooHigh?.delta).toBe(100)
    expect(byName.tooLow?.delta).toBe(50)
  })

  it("tolerance absorbs float-precision drift", () => {
    const inv = registerInvariant({
      name: "float test",
      reducers: {
        canonical: () => 0.1 + 0.2, // 0.30000000000000004
        rounded: () => 0.3,
      },
    })
    const violations = checkInvariant(inv, null)
    expect(violations).toEqual([]) // within 0.01 tolerance
  })

  it("assertInvariantHolds throws a multi-line readable error", () => {
    const inv = registerInvariant({
      name: "broken",
      reducers: {
        canonical: () => 100,
        surface_a: () => 90,
        surface_b: () => 110,
      },
    })
    expect(() => assertInvariantHolds(inv, null)).toThrow(/surface_a/)
    expect(() => assertInvariantHolds(inv, null)).toThrow(/surface_b/)
  })

  it("catches the actual W1.U-B class of drift bug between earned reducers", () => {
    // If someone accidentally replaced sumEarnedRebatesYTD's YTD filter
    // with Lifetime, this test would fire. The two are DIFFERENT
    // invariants (YTD ≤ Lifetime by design), so we can't blindly assert
    // equal — but we CAN lock down that the YTD reducer is the ONE used
    // everywhere the contract spec says "YTD".
    const today = new Date("2026-06-15")
    const rows = [
      {
        payPeriodEnd: new Date("2025-09-30"), // last year, counts in lifetime not YTD
        rebateEarned: 672,
      },
      {
        payPeriodEnd: new Date("2026-03-31"),
        rebateEarned: 500,
      },
      {
        payPeriodEnd: new Date("2026-07-31"), // future, excluded from both
        rebateEarned: 999,
      },
    ]
    // The invariant "YTD column uses sumEarnedRebatesYTD" — both
    // reducers below should return the same value.
    const ytdInvariant = registerInvariant({
      name: "rebateEarnedYTD canonical",
      reducers: {
        canonical: () => sumEarnedRebatesYTD(rows, today),
        list_column: () => sumEarnedRebatesYTD(rows, today),
      },
    })
    expect(() => assertInvariantHolds(ytdInvariant, null)).not.toThrow()

    // If a future drift bug rewrites the list column to use lifetime:
    const drifted = registerInvariant({
      name: "rebateEarnedYTD drift",
      reducers: {
        canonical: () => sumEarnedRebatesYTD(rows, today),
        list_column_drifted: () => sumEarnedRebatesLifetime(rows, today),
      },
    })
    // YTD=500, Lifetime=1172, delta=672. Should fire.
    const v = checkInvariant(drifted, null)
    expect(v).toHaveLength(1)
    expect(v[0]?.delta).toBe(672)
  })

  it("locks down sumCollectedRebates as the single collected reducer", () => {
    const rows = [
      { collectionDate: new Date("2025-01-01"), rebateCollected: 100 },
      { collectionDate: null, rebateCollected: 50 }, // excluded
      { collectionDate: new Date("2025-02-01"), rebateCollected: 200 },
    ]
    const inv = registerInvariant({
      name: "rebates collected canonical",
      reducers: {
        canonical: () => sumCollectedRebates(rows),
        // Drift-hazard surrogate: what if a callsite forgot the
        // collectionDate filter?
        no_filter: () =>
          rows.reduce((s, r) => s + Number(r.rebateCollected ?? 0), 0),
      },
    })
    const v = checkInvariant(inv, null)
    // canonical = 300, no_filter = 350. Delta = 50. Fires.
    expect(v).toHaveLength(1)
    expect(v[0]?.delta).toBe(50)
  })
})
