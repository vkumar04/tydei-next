import { describe, expect, it } from "vitest"
import { isUsableVendorNameKey, vendorNameKey } from "@/lib/vendors/normalize"

describe("vendorNameKey", () => {
  it("collapses case, punctuation and corporate suffixes", () => {
    // These are the spellings that must resolve WITHOUT anyone declaring an
    // alias — they are pure formatting drift around the same legal name.
    for (const name of [
      "Stryker",
      "Stryker Corp",
      "Stryker Corp.",
      "STRYKER CORPORATION",
      "Stryker, Inc.",
      "  stryker   inc  ",
    ]) {
      expect(vendorNameKey(name)).toBe("stryker")
    }
  })

  it("strips stacked suffixes", () => {
    expect(vendorNameKey("Acme Corp Inc")).toBe("acme")
    expect(vendorNameKey("Acme Holdings LLC")).toBe("acme")
  })

  it("keeps genuinely different companies distinct", () => {
    // The whole point: over-merging cross-attributes spend between companies,
    // which is a financial error, not a reporting gap.
    const keys = [
      "Stryker",
      "Stryker Sales Corp",
      "Howmedica Osteonics",
      "MAKO Surgical Corp",
      "Stryker Flex Financial",
      "Smith & Nephew",
      "Zimmer Biomet",
    ].map(vendorNameKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("does not confuse similarly-named distinct vendors", () => {
    expect(vendorNameKey("Integra LifeSciences")).not.toBe(
      vendorNameKey("Integra Medical"),
    )
  })

  it("returns an empty, unusable key for suffix-only junk", () => {
    // "" must never be used as a match key or every junk name would collapse
    // onto one vendor.
    for (const junk of ["Inc.", "LLC", "  ,, ", "corp"]) {
      expect(vendorNameKey(junk)).toBe("")
      expect(isUsableVendorNameKey(junk)).toBe(false)
    }
  })

  it("is stable under repeated application", () => {
    const once = vendorNameKey("Stryker Sales Corp.")
    expect(vendorNameKey(once)).toBe(once)
  })
})
