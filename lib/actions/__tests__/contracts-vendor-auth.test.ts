import { describe, it, expect } from "vitest"
import {
  contractsOwnedByVendor,
  contractOwnershipWhereVendor,
  scopeContractWhereToFacility,
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

  // ─── Division isolation (Settings/Users feature) ────────────────

  it("divisionIds undefined is byte-identical to the un-scoped predicate", () => {
    expect(contractsOwnedByVendor("v1", undefined)).toEqual(contractsOwnedByVendor("v1"))
    expect(contractOwnershipWhereVendor("c1", "v1", undefined)).toEqual(
      contractOwnershipWhereVendor("c1", "v1"),
    )
  })

  it("divisionIds [] matches nothing (caller attached to no divisions)", () => {
    const where = contractsOwnedByVendor("v1", [])
    expect(where).toEqual({
      AND: [
        { OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }] },
        { vendorDivisionId: { in: [] } },
      ],
    })
  })

  it("divisionIds [..] AND-ins the division scope while preserving the grouped branch", () => {
    expect(contractsOwnedByVendor("v1", ["d1", "d2"])).toEqual({
      AND: [
        { OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }] },
        { vendorDivisionId: { in: ["d1", "d2"] } },
      ],
    })
  })

  it("contractOwnershipWhereVendor with divisions keeps id + ownership + division", () => {
    expect(contractOwnershipWhereVendor("c1", "v1", ["d1"])).toEqual({
      AND: [
        { id: "c1", OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }] },
        { vendorDivisionId: { in: ["d1"] } },
      ],
    })
  })

  describe("scopeContractWhereToFacility", () => {
    const base = contractsOwnedByVendor("v1")

    it("returns the base unchanged for undefined / 'all' (all-facilities view)", () => {
      expect(scopeContractWhereToFacility(base, undefined)).toBe(base)
      expect(scopeContractWhereToFacility(base, "all")).toBe(base)
    })

    it("AND-narrows to a single facility as a sibling top-level key", () => {
      expect(scopeContractWhereToFacility(base, "f1")).toEqual({
        OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }],
        facilityId: "f1",
      })
    })

    it("preserves a division-scoped AND base when narrowing by facility", () => {
      const scoped = contractsOwnedByVendor("v1", ["d1"])
      expect(scopeContractWhereToFacility(scoped, "f1")).toEqual({
        AND: [
          { OR: [{ vendorId: "v1" }, { additionalVendorIds: { has: "v1" } }] },
          { vendorDivisionId: { in: ["d1"] } },
        ],
        facilityId: "f1",
      })
    })
  })
})
