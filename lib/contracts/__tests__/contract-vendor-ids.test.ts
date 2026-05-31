import { describe, it, expect } from "vitest"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"

describe("contractVendorIds", () => {
  it("returns just the primary vendor when not grouped", () => {
    expect(contractVendorIds({ vendorId: "v1" })).toEqual(["v1"])
    expect(contractVendorIds({ vendorId: "v1", additionalVendorIds: [] })).toEqual(["v1"])
  })

  it("includes additional vendors for a grouped contract", () => {
    expect(
      contractVendorIds({ vendorId: "v1", additionalVendorIds: ["v2", "v3"] }),
    ).toEqual(["v1", "v2", "v3"])
  })

  it("de-dupes the primary appearing again in additionals", () => {
    expect(
      contractVendorIds({ vendorId: "v1", additionalVendorIds: ["v1", "v2"] }),
    ).toEqual(["v1", "v2"])
  })

  it("drops null/empty entries", () => {
    expect(
      contractVendorIds({ vendorId: null, additionalVendorIds: ["v2", ""] }),
    ).toEqual(["v2"])
    expect(contractVendorIds({ vendorId: null })).toEqual([])
  })
})
