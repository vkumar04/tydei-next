import { describe, it, expect } from "vitest"
import {
  contractOwnershipWhere,
  contractsOwnedByFacility,
} from "../contracts-auth"

describe("contractOwnershipWhere", () => {
  it("returns a where-unique-input scoping id to facility ownership", () => {
    const where = contractOwnershipWhere("contract-1", "fac-1")
    expect(where.id).toBe("contract-1")
    expect(where.OR).toEqual([
      { facilityId: "fac-1" },
      { contractFacilities: { some: { facilityId: "fac-1" } } },
    ])
  })
})

describe("contractsOwnedByFacility", () => {
  it("returns a where-input filter for facility-owned contracts", () => {
    const filter = contractsOwnedByFacility("fac-1")
    expect(filter.OR).toEqual([
      { facilityId: "fac-1" },
      { contractFacilities: { some: { facilityId: "fac-1" } } },
    ])
    expect("id" in filter).toBe(false)
  })
})
