import { describe, it, expect } from "vitest"
import { isSpendDollarTerm } from "../upload-proposal-tab"

// Guards the broadened spend-dollar term filter — the proposal lookback + the
// score's top-tier rate both gate on this. Before broadening, only
// {spend_rebate, growth_rebate, ""} matched, so the AI's varied spend-rebate
// labels were dropped and "tiers weren't picked up like contracts"
// (Vick 2026-06-22).
describe("isSpendDollarTerm", () => {
  it("includes the spend-dollar rebate family (incl. broadened labels)", () => {
    for (const t of [
      "spend_rebate",
      "growth_rebate",
      "percent_of_spend",
      "spend_based",
      "usage",
      "",
    ]) {
      expect(isSpendDollarTerm(t)).toBe(true)
    }
  })

  it("is case- and spacing-insensitive (AI emits 'Spend Rebate')", () => {
    expect(isSpendDollarTerm("Spend Rebate")).toBe(true)
    expect(isSpendDollarTerm("  PERCENT_OF_SPEND  ")).toBe(true)
    expect(isSpendDollarTerm("Spend Based")).toBe(true)
  })

  it("excludes non-spend-dollar types (they store %/count or pay per-SKU)", () => {
    for (const t of [
      "market_share",
      "volume_rebate",
      "carve_out",
      "fixed_rebate",
      "per_procedure_rebate",
    ]) {
      expect(isSpendDollarTerm(t)).toBe(false)
    }
  })

  it("treats null/undefined as the empty (default-in) case", () => {
    expect(isSpendDollarTerm(null)).toBe(true)
    expect(isSpendDollarTerm(undefined)).toBe(true)
  })
})
