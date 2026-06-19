import { describe, it, expect } from "vitest"
import { contractsOwnedByFacilities } from "../contracts-auth"

/**
 * Pure scope-shape tests for the enterprise / assigned-facility set used by
 * `lib/actions/facility-assignment.ts` (`getCallerFacilityIds`). The set is
 * consumed by `contractsOwnedByFacilities` to bound every enterprise read,
 * so we lock its where-clause shape here. DB-free.
 */
describe("contractsOwnedByFacilities (enterprise facility scope)", () => {
  it("returns an OR-of-`in` over both the primary and join facility", () => {
    const where = contractsOwnedByFacilities(["fac-1", "fac-2", "fac-3"])
    expect(where.OR).toEqual([
      { facilityId: { in: ["fac-1", "fac-2", "fac-3"] } },
      { contractFacilities: { some: { facilityId: { in: ["fac-1", "fac-2", "fac-3"] } } } },
    ])
    // No bare top-level id — ownership is expressed purely by the set.
    expect("id" in where).toBe(false)
  })

  it("matches a single-facility scope (scoped user with only their home facility)", () => {
    const where = contractsOwnedByFacilities(["fac-1"])
    expect(where.OR).toEqual([
      { facilityId: { in: ["fac-1"] } },
      { contractFacilities: { some: { facilityId: { in: ["fac-1"] } } } },
    ])
  })

  it("matches NOTHING for an empty set (no assignments ⇒ no contracts)", () => {
    const where = contractsOwnedByFacilities([])
    // `in: []` is Prisma's canonical "matches no row" predicate, and the OR
    // of two empty-in branches resolves to the empty set — the safe default
    // for a scoped user with zero facility assignments.
    expect(where.OR).toEqual([
      { facilityId: { in: [] } },
      { contractFacilities: { some: { facilityId: { in: [] } } } },
    ])
  })
})
