/**
 * Charles 2026-04-30 bug F: AI vendor pick from PDF was unreliable
 * because the helper returned the FIRST substring match. With multiple
 * "Stryker" rows in the vendor list (Endoscopy, Spine, Mako), the
 * wrong one won. The new scorer prefers exact → normalized → fuzzy.
 */
import { describe, it, expect } from "vitest"
import { matchOrCreateVendorId } from "../new-contract-helpers"

const VENDORS = [
  { id: "v1", name: "Stryker, Inc", displayName: null },
  { id: "v2", name: "Stryker Endoscopy", displayName: null },
  { id: "v3", name: "Stryker Mako", displayName: null },
  { id: "v4", name: "Smith & Nephew Inc", displayName: "Smith & Nephew" },
  { id: "v5", name: "Johnson & Johnson", displayName: "J&J" },
  { id: "v6", name: "Medtronic plc", displayName: "Medtronic" },
]

describe("matchOrCreateVendorId — Charles bug F regression", () => {
  it("exact match wins on case-insensitive name", () => {
    expect(matchOrCreateVendorId("Stryker, Inc", VENDORS)).toBe("v1")
    expect(matchOrCreateVendorId("stryker, inc", VENDORS)).toBe("v1")
  })

  it("normalized match wins when AI returns the legal entity (Inc/LLC stripped)", () => {
    // similarity helper strips Inc; "Smith & Nephew" should normalize to v4
    expect(matchOrCreateVendorId("Smith & Nephew", VENDORS)).toBe("v4")
  })

  it("displayName is considered alongside name", () => {
    // displayName "J&J" should match
    expect(matchOrCreateVendorId("J&J", VENDORS)).toBe("v5")
  })

  it("AI returns subsidiary 'Stryker Mako' → matches the Mako-specific row", () => {
    expect(matchOrCreateVendorId("Stryker Mako", VENDORS)).toBe("v3")
  })

  it("AI returns short brand 'Stryker' → matches Stryker, Inc (highest similarity to plain brand)", () => {
    // The plain "Stryker" should prefer "Stryker, Inc" over the
    // longer division names since the normalized form is closest.
    expect(matchOrCreateVendorId("Stryker", VENDORS)).toBe("v1")
  })

  it("returns null on unknown vendor instead of mismatching", () => {
    expect(matchOrCreateVendorId("Acme Robotics", VENDORS)).toBeNull()
  })

  it("returns null on empty input", () => {
    expect(matchOrCreateVendorId("", VENDORS)).toBeNull()
    expect(matchOrCreateVendorId("   ", VENDORS)).toBeNull()
  })
})
