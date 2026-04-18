import { describe, it, expect } from "vitest"
import {
  buildDisputeNote,
  parseDisputeNote,
} from "../dispute-templates"

describe("buildDisputeNote", () => {
  it("builds full-form note with all fields", () => {
    const note = buildDisputeNote({
      reason: "price_overcharge",
      amount: 250.5,
      lineReference: "LINE-12",
      userNote: "Invoice charged $500 for item priced $250 on contract",
    })
    expect(note).toBe(
      "[Price overcharge] ($250.50) [line: LINE-12] Invoice charged $500 for item priced $250 on contract",
    )
  })

  it("omits amount when null/undefined", () => {
    const note = buildDisputeNote({
      reason: "off_contract_item",
      amount: null,
      userNote: "Items not on approved list",
    })
    expect(note).toBe("[Off-contract item] Items not on approved list")
  })

  it("omits line reference when empty", () => {
    const note = buildDisputeNote({
      reason: "duplicate_charge",
      amount: 100,
      lineReference: "",
      userNote: "Charged twice",
    })
    expect(note).toBe("[Duplicate charge] ($100.00) Charged twice")
  })

  it("trims user note", () => {
    const note = buildDisputeNote({
      reason: "other",
      userNote: "   Some note text   ",
    })
    expect(note).toBe("[Other] Some note text")
  })

  it("trims line reference", () => {
    const note = buildDisputeNote({
      reason: "other",
      lineReference: "  LINE-5  ",
      userNote: "X",
    })
    expect(note).toContain("[line: LINE-5]")
  })

  it("handles empty user note (reason label still shows)", () => {
    const note = buildDisputeNote({
      reason: "missing_credit",
      userNote: "",
    })
    expect(note).toBe("[Missing credit]")
  })

  it("formats amount with 2 decimal places", () => {
    const note = buildDisputeNote({
      reason: "price_overcharge",
      amount: 100,
      userNote: "X",
    })
    expect(note).toContain("($100.00)")
  })
})

describe("parseDisputeNote", () => {
  it("round-trips full-form note", () => {
    const original = {
      reason: "price_overcharge" as const,
      amount: 250.5,
      lineReference: "LINE-12",
      userNote: "Invoice charged too much",
    }
    const note = buildDisputeNote(original)
    const parsed = parseDisputeNote(note)
    expect(parsed).toEqual(original)
  })

  it("round-trips note without amount", () => {
    const original = {
      reason: "off_contract_item" as const,
      amount: null,
      lineReference: null,
      userNote: "Not on approved list",
    }
    const note = buildDisputeNote(original)
    const parsed = parseDisputeNote(note)
    expect(parsed).toEqual(original)
  })

  it("returns null for legacy freeform notes", () => {
    expect(parseDisputeNote("just a regular note with no prefix")).toBeNull()
    expect(parseDisputeNote("")).toBeNull()
  })

  it("returns null for unknown reason label", () => {
    expect(parseDisputeNote("[Bogus Label] rest of note")).toBeNull()
  })

  it("handles userNote with special chars", () => {
    const original = {
      reason: "other" as const,
      amount: 50,
      lineReference: null,
      userNote: "Line has (parens) and [brackets]",
    }
    const parsed = parseDisputeNote(buildDisputeNote(original))
    expect(parsed?.userNote).toBe("Line has (parens) and [brackets]")
  })

  it("parses note with line reference but no amount", () => {
    const note = "[Quantity mismatch] [line: L-7] Expected 10, got 12"
    const parsed = parseDisputeNote(note)
    expect(parsed).toEqual({
      reason: "quantity_mismatch",
      amount: null,
      lineReference: "L-7",
      userNote: "Expected 10, got 12",
    })
  })
})
