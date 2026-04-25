import { describe, it, expect } from "vitest"
import {
  asPercentFraction,
  readTierRebateAsFraction,
  toDisplayRebateValue,
  unwrapPercentFraction,
  type PercentFraction,
} from "@/lib/contracts/rebate-value-normalize"

/**
 * Charles 2026-04-25 (audit follow-up — branded type rollout).
 *
 * The PercentFraction brand exists at the type level only —
 * runtime is just `number`. Verify the helpers preserve the
 * underlying value through the wrap/unwrap cycle and that the
 * display scaler accepts both branded and plain inputs (so the
 * migration can be gradual).
 */
describe("PercentFraction brand", () => {
  it("readTierRebateAsFraction wraps a raw Prisma fraction", () => {
    const tier = { rebateType: "percent_of_spend", rebateValue: 0.03 }
    const branded = readTierRebateAsFraction(tier)
    // Runtime: it's still 0.03 — brand is a TS-only marker.
    expect(branded).toBe(0.03)
    // Unwrap is a no-op runtime cast.
    expect(unwrapPercentFraction(branded)).toBe(0.03)
  })

  it("asPercentFraction rejects nothing at runtime — protection is compile-time", () => {
    // Branded helpers are pure at runtime; the value of the brand
    // is in the type system catching `spend × fraction` without
    // the explicit unwrap. Document the runtime no-op so future
    // contributors don't expect a runtime guard.
    const v: PercentFraction = asPercentFraction(0.05)
    expect(v as number).toBe(0.05)
  })

  it("toDisplayRebateValue accepts both branded fraction and plain number", () => {
    const branded: PercentFraction = asPercentFraction(0.03)
    expect(toDisplayRebateValue("percent_of_spend", branded)).toBe(3)
    // Same number unbranded — the helper doesn't care about the
    // brand at runtime.
    expect(toDisplayRebateValue("percent_of_spend", 0.03)).toBe(3)
  })

  it("dollar-denominated rebateTypes pass through unchanged", () => {
    const branded: PercentFraction = asPercentFraction(1500)
    // The brand is misnamed for dollar values, but
    // toDisplayRebateValue short-circuits non-percent types.
    expect(toDisplayRebateValue("fixed_rebate", branded)).toBe(1500)
    expect(toDisplayRebateValue("fixed_rebate", 1500)).toBe(1500)
  })

  it("readTierRebateAsFraction handles null rebateValue defensively", () => {
    const tier = { rebateType: "percent_of_spend", rebateValue: null }
    expect(readTierRebateAsFraction(tier)).toBe(0)
  })
})
