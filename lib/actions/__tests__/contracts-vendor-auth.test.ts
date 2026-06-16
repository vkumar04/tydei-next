import { describe, it, expect } from "vitest"
import {
  contractsOwnedByVendor,
  contractOwnershipWhereVendor,
} from "@/lib/actions/contracts-vendor-auth"

describe("contracts-vendor-auth", () => {
  it("contractsOwnedByVendor scopes by primary vendorId OR grouped membership", () => {
    expect(contractsOwnedByVendor("v1")).toEqual({
      OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }],
    })
  })

  it("contractOwnershipWhereVendor adds the id constraint", () => {
    expect(contractOwnershipWhereVendor("c1", "v1")).toEqual({
      id: "c1",
      OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }],
    })
  })

  it("never scopes by bare vendorId (grouped-membership branch always present)", () => {
    const where = contractsOwnedByVendor("v9")
    // The OR must contain the additionalVendorIds branch — guards the
    // group-vendor-drift regression class.
    expect(where.OR).toContainEqual({ additionalVendorIds: { has: "v9" } })
  })
})
