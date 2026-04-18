import { describe, it, expect } from "vitest"
import { matchOrCreateVendorId } from "@/components/contracts/new-contract-helpers"

describe("matchOrCreateVendorId", () => {
  it("matches by case-insensitive prefix when name fragment is provided", () => {
    const vendors = [
      { id: "v1", name: "Stryker Corporation", displayName: null },
      { id: "v2", name: "Medtronic Inc.", displayName: "Medtronic" },
    ]
    expect(matchOrCreateVendorId("Stryker", vendors)).toBe("v1")
    expect(matchOrCreateVendorId("medtronic", vendors)).toBe("v2")
    expect(matchOrCreateVendorId("Medtronic Inc.", vendors)).toBe("v2")
  })

  it("returns null when vendorName is empty", () => {
    expect(matchOrCreateVendorId("", [{ id: "v1", name: "x", displayName: null }])).toBeNull()
    expect(matchOrCreateVendorId("   ", [])).toBeNull()
  })

  it("returns null (caller will create) when no vendor matches", () => {
    expect(matchOrCreateVendorId("BrandNew Corp", [{ id: "v1", name: "Stryker", displayName: null }])).toBeNull()
  })
})
