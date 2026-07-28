import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Facility scope "all" must mean "every facility THIS CALLER can reach" —
 * never "every facility in the database".
 *
 * The bug this pins (2026-07-28, wrong-scope sweep): `facilityScopeClause`
 * returned an unbounded `{}` for scope "all" whenever no accessible-facility
 * set was passed, and NEITHER call site passed one. `{}` matches every row of
 * `Contract`, so a facility user who flipped the contracts list to "All" read,
 * counted, summed and CSV-exported every other tenant's contracts. Against the
 * dev seed that is 19 contracts across 3 unrelated health systems where a
 * Lighthouse Health user may see 10.
 *
 * Invariants:
 *   1. Scope "all" NEVER yields an empty (unbounded) where-clause — not from
 *      `getContracts`, not from `getContractStats`, not from the helper.
 *   2. The set comes from `getCallerFacilityIds` — the canonical owner of
 *      "which facilities can this caller reach" (enterprise → HealthSystem
 *      universe; scoped → FacilityAssignment set ∪ home facility). It is not
 *      re-derived here.
 *   3. The fix NARROWS. An enterprise caller keeps their whole health system;
 *      a scoped caller collapses to their own assignments.
 *   4. "this" / "shared" are unchanged and pay no extra round trip.
 *   5. The stats hero's rebate ledger is bounded to the SAME facility set the
 *      contract counts were computed over — money and counts, one row, one set.
 *   6. The list's per-row SPEND column is aggregated over that same facility
 *      set. Widening the row set without widening the money behind each row
 *      was the second half of this bug: under "all" a sibling facility's
 *      contract rendered the HOME facility's dollars. Measured on the dev
 *      seed for a Lighthouse Surgical Center caller — "Stryker Surgical
 *      Navigation" (owned by Lighthouse Community Hospital) showed
 *      $2,148,700 of LSC's own Stryker spend where the contract's real
 *      12-month figure is $504,200.
 */

import {
  facilityScopeClause,
  contractsOwnedByFacilities,
  contractsOwnedByFacility,
} from "@/lib/actions/contracts-auth"

// ─── Pure where-clause shape ─────────────────────────────────────

describe("facilityScopeClause('all') — never unbounded", () => {
  it("bounds to the accessible set when one is supplied", () => {
    const ids = ["fac-home", "fac-sibling", "fac-third"]
    expect(facilityScopeClause("all", "fac-home", ids)).toEqual(
      contractsOwnedByFacilities(ids),
    )
  })

  it("fails CLOSED to the caller's own facility when the set is omitted", () => {
    // The old behaviour was `{}` — every contract in the database. A caller
    // that forgets to thread the set must now under-count, never leak.
    const where = facilityScopeClause("all", "fac-home")
    expect(where).toEqual(contractsOwnedByFacility("fac-home"))
    expect(Object.keys(where)).not.toHaveLength(0)
    expect(JSON.stringify(where)).toContain("fac-home")
  })

  it("treats an EMPTY set as 'reaches nothing', not as 'omitted'", () => {
    // `[]` is a real answer (a scoped user with no reachable facility), and
    // it must not fall through to the caller's own facility or to `{}`.
    expect(facilityScopeClause("all", "fac-home", [])).toEqual(
      contractsOwnedByFacilities([]),
    )
    expect(JSON.stringify(facilityScopeClause("all", "fac-home", []))).not.toContain(
      "fac-home",
    )
  })

  it("leaves 'this' and 'shared' untouched by the accessible set", () => {
    const ids = ["fac-home", "fac-sibling"]
    expect(facilityScopeClause("this", "fac-home", ids)).toEqual(
      facilityScopeClause("this", "fac-home"),
    )
    expect(facilityScopeClause("shared", "fac-home", ids)).toEqual(
      facilityScopeClause("shared", "fac-home"),
    )
  })
})

// ─── Server actions ──────────────────────────────────────────────

const {
  findManyMock,
  countMock,
  groupByMock,
  aggregateMock,
  rebateAggregateMock,
  cogGroupByMock,
  periodGroupByMock,
  callerFacilityIdsMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn().mockResolvedValue([]),
  countMock: vi.fn().mockResolvedValue(0),
  groupByMock: vi.fn().mockResolvedValue([{ status: "active", _count: 0 }]),
  aggregateMock: vi
    .fn()
    .mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } }),
  rebateAggregateMock: vi.fn().mockResolvedValue({ _sum: { rebateEarned: 0 } }),
  cogGroupByMock: vi.fn().mockResolvedValue([]),
  periodGroupByMock: vi.fn().mockResolvedValue([]),
  callerFacilityIdsMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: findManyMock,
      count: countMock,
      groupBy: groupByMock,
      aggregate: aggregateMock,
    },
    rebate: { aggregate: rebateAggregateMock },
    cOGRecord: { groupBy: cogGroupByMock },
    contractPeriod: { groupBy: periodGroupByMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-home", healthSystemId: "hs-1", organizationId: "org-1" },
    user: { id: "u-caller" },
  }),
}))

vi.mock("@/lib/actions/facility-assignment", () => ({
  getCallerFacilityIds: callerFacilityIdsMock,
}))

import { getContracts, getContractStats } from "@/lib/actions/contracts"

/** Enterprise caller: the whole Lighthouse Health universe. */
const HS_UNIVERSE = ["fac-home", "fac-sibling", "fac-third"]

/** One list row, shaped as `getContracts`'s `include` returns it. */
const SIBLING_ROW = {
  id: "ctr-sibling",
  name: "Stryker Surgical Navigation",
  vendorId: "ven-stryker",
  additionalVendorIds: [] as string[],
  // Owned by a SIBLING facility — reachable under "all", not under "this".
  facilityId: "fac-sibling",
  vendor: { id: "ven-stryker", name: "Stryker" },
  productCategory: null,
  facility: { id: "fac-sibling", name: "Lighthouse Community Hospital" },
  rebates: [] as unknown[],
  terms: [] as unknown[],
}

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockResolvedValue([])
  countMock.mockResolvedValue(0)
  groupByMock.mockResolvedValue([{ status: "active", _count: 0 }])
  aggregateMock.mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } })
  rebateAggregateMock.mockResolvedValue({ _sum: { rebateEarned: 0 } })
  cogGroupByMock.mockResolvedValue([])
  periodGroupByMock.mockResolvedValue([])
  callerFacilityIdsMock.mockResolvedValue(HS_UNIVERSE)
})

describe("getContracts — scope 'all' is bounded to the accessible set", () => {
  it("resolves 'all' through getCallerFacilityIds and bounds the list query", async () => {
    await getContracts({ facilityScope: "all" })

    expect(callerFacilityIdsMock).toHaveBeenCalledTimes(1)
    const where = findManyMock.mock.calls[0][0].where
    expect(JSON.stringify(where)).toContain(
      JSON.stringify(contractsOwnedByFacilities(HS_UNIVERSE)),
    )
  })

  it("counts over the SAME bounded where the rows came from", async () => {
    await getContracts({ facilityScope: "all" })
    expect(JSON.stringify(countMock.mock.calls[0][0].where)).toBe(
      JSON.stringify(findManyMock.mock.calls[0][0].where),
    )
  })

  it("NARROWS: a scoped caller reaching only their home facility sees only it", async () => {
    // getCallerFacilityIds always includes the home facility, so a scoped
    // user with zero assignments resolves to exactly one id — not the DB.
    callerFacilityIdsMock.mockResolvedValue(["fac-home"])
    await getContracts({ facilityScope: "all" })

    const where = JSON.stringify(findManyMock.mock.calls[0][0].where)
    expect(where).toContain("fac-home")
    expect(where).not.toContain("fac-sibling")
    expect(where).not.toContain("fac-third")
  })

  it("does NOT widen: an enterprise caller keeps every facility in their health system", async () => {
    await getContracts({ facilityScope: "all" })
    const where = JSON.stringify(findManyMock.mock.calls[0][0].where)
    for (const id of HS_UNIVERSE) expect(where).toContain(id)
  })

  it("never issues an unbounded where under 'all'", async () => {
    await getContracts({ facilityScope: "all" })
    const conditions = findManyMock.mock.calls[0][0].where.AND as Array<
      Record<string, unknown>
    >
    // Every ANDed clause carries a predicate; an empty `{}` in the list would
    // be the unbounded branch leaking back in.
    for (const clause of conditions) {
      expect(Object.keys(clause).length).toBeGreaterThan(0)
    }
  })

  it("does not resolve the accessible set for 'this' or 'shared'", async () => {
    await getContracts({})
    await getContracts({ facilityScope: "shared" })
    expect(callerFacilityIdsMock).not.toHaveBeenCalled()
  })
})

describe("getContractStats — scope 'all' is bounded to the accessible set", () => {
  it("bounds every hero number to the accessible set", async () => {
    await getContractStats({ facilityScope: "all" })

    expect(callerFacilityIdsMock).toHaveBeenCalledTimes(1)
    const bounded = JSON.stringify(contractsOwnedByFacilities(HS_UNIVERSE))
    for (const mock of [groupByMock, aggregateMock, countMock]) {
      expect(JSON.stringify(mock.mock.calls[0][0].where)).toContain(bounded)
    }
  })

  it("the hero and the list describe the same contract universe", async () => {
    await getContractStats({ facilityScope: "all" })
    await getContracts({ facilityScope: "all" })

    const statsWhere = JSON.stringify(groupByMock.mock.calls[0][0].where)
    const listConditions = findManyMock.mock.calls[0][0].where.AND as Array<
      Record<string, unknown>
    >
    expect(JSON.stringify(listConditions[0])).toBe(statsWhere)
  })

  it("bounds the rebate ledger to the SAME facility set the counts used", async () => {
    await getContractStats({ facilityScope: "all" })
    const rebateWhere = rebateAggregateMock.mock.calls[0][0].where

    // Contract-side: identical predicate to the counts.
    expect(JSON.stringify(rebateWhere.contract)).toBe(
      JSON.stringify(groupByMock.mock.calls[0][0].where),
    )
    // Facility-side: the accessible set, never dropped, never global.
    expect(rebateWhere.facilityId).toEqual({ in: HS_UNIVERSE })
  })

  it("keeps the ledger pinned to the single facility under 'this' and 'shared'", async () => {
    await getContractStats({})
    expect(rebateAggregateMock.mock.calls[0][0].where.facilityId).toBe("fac-home")

    vi.clearAllMocks()
    callerFacilityIdsMock.mockResolvedValue(HS_UNIVERSE)
    groupByMock.mockResolvedValue([{ status: "active", _count: 0 }])
    aggregateMock.mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } })
    rebateAggregateMock.mockResolvedValue({ _sum: { rebateEarned: 0 } })

    await getContractStats({ facilityScope: "shared" })
    expect(rebateAggregateMock.mock.calls[0][0].where.facilityId).toBe("fac-home")
    expect(callerFacilityIdsMock).not.toHaveBeenCalled()
  })

  it("the ledger's facility bound is never absent, whatever the scope", async () => {
    for (const facilityScope of ["this", "all", "shared"] as const) {
      vi.clearAllMocks()
      callerFacilityIdsMock.mockResolvedValue(HS_UNIVERSE)
      groupByMock.mockResolvedValue([{ status: "active", _count: 0 }])
      aggregateMock.mockResolvedValue({ _sum: { totalValue: 0, annualValue: 0 } })
      rebateAggregateMock.mockResolvedValue({ _sum: { rebateEarned: 0 } })

      await getContractStats({ facilityScope })
      const { facilityId } = rebateAggregateMock.mock.calls[0][0].where
      expect(facilityId).toBeDefined()
      expect(JSON.stringify(facilityId)).toContain("fac-home")
    }
  })

  it("a scoped caller's 'all' hero collapses to their own facility", async () => {
    callerFacilityIdsMock.mockResolvedValue(["fac-home"])
    await getContractStats({ facilityScope: "all" })

    const where = JSON.stringify(groupByMock.mock.calls[0][0].where)
    expect(where).toContain("fac-home")
    expect(where).not.toContain("fac-sibling")
    expect(rebateAggregateMock.mock.calls[0][0].where.facilityId).toEqual({
      in: ["fac-home"],
    })
  })
})

// ─── The money behind each row ───────────────────────────────────
//
// Second half of the same defect. Widening the ROW SET without widening the
// per-row aggregate leaves a sibling facility's contract showing the HOME
// facility's dollars in the "Current Spend (Last 12 Months)" column — the
// tier-3 vendor-window fallback is what makes it look plausible instead of
// blank.

type CogGroupByArgs = { by: string[]; where: { facilityId: unknown } }

const cogCalls = (): CogGroupByArgs[] =>
  cogGroupByMock.mock.calls.map((c) => c[0] as CogGroupByArgs)

/** The three spend aggregates (contractId / vendorId / vendorId+category). */
const spendCalls = (): CogGroupByArgs[] =>
  cogCalls().filter(
    (c) => c.by.includes("contractId") || c.by.includes("vendorId"),
  )

/** The drifted-category universe lookups (`groupBy(['category'])`). */
const universeCalls = (): CogGroupByArgs[] =>
  cogCalls().filter((c) => c.by.length === 1 && c.by[0] === "category")

describe("getContracts — the SPEND column uses the row set's facility universe", () => {
  it("reads COG over the accessible set under 'all'", async () => {
    findManyMock.mockResolvedValue([SIBLING_ROW])
    await getContracts({ facilityScope: "all" })

    const calls = spendCalls()
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.where.facilityId).toEqual({ in: HS_UNIVERSE })
    }
  })

  it("stays pinned to the caller's own facility under 'this' and 'shared'", async () => {
    for (const facilityScope of ["this", "shared"] as const) {
      vi.clearAllMocks()
      findManyMock.mockResolvedValue([SIBLING_ROW])
      countMock.mockResolvedValue(1)
      cogGroupByMock.mockResolvedValue([])
      periodGroupByMock.mockResolvedValue([])

      await getContracts({ facilityScope })
      for (const call of spendCalls()) {
        expect(call.where.facilityId).toBe("fac-home")
      }
      expect(callerFacilityIdsMock).not.toHaveBeenCalled()
    }
  })

  it("does not render the home facility's dollars on a sibling's contract", async () => {
    // Dev-seed shape: LSC's own trailing-12mo Stryker window is $2,148,700;
    // the Lighthouse Community Hospital contract's real figure is $504,200.
    // Reading COG at `fac-home` only, tier 2 finds nothing and tier 3 hands
    // the row LSC's $2,148,700 — the wrong facility's money, presented as
    // this contract's spend.
    findManyMock.mockResolvedValue([SIBLING_ROW])
    cogGroupByMock.mockImplementation(async (args: CogGroupByArgs) => {
      const scope = JSON.stringify(args.where.facilityId)
      if (args.by.includes("contractId")) {
        return scope.includes("fac-sibling")
          ? [{ contractId: "ctr-sibling", _sum: { extendedPrice: 504200 } }]
          : []
      }
      if (args.by.includes("vendorId")) {
        return [{ vendorId: "ven-stryker", _sum: { extendedPrice: 2148700 } }]
      }
      return []
    })

    const { contracts } = await getContracts({ facilityScope: "all" })
    expect(contracts).toHaveLength(1)
    expect(contracts[0].currentSpend).toBe(504200)
  })

  it("resolves the drifted-category universe over that same set, once per facility", async () => {
    findManyMock.mockResolvedValue([
      SIBLING_ROW,
      { ...SIBLING_ROW, id: "ctr-second" },
    ])
    await getContracts({ facilityScope: "all" })

    // One lookup per reachable facility — bounded by the accessible set, NOT
    // one per contract row (two rows here, still three lookups).
    expect(universeCalls()).toHaveLength(HS_UNIVERSE.length)
    expect(universeCalls().map((c) => c.where.facilityId).sort()).toEqual(
      [...HS_UNIVERSE].sort(),
    )
  })

  it("reads only the caller's own category universe under 'this'", async () => {
    findManyMock.mockResolvedValue([SIBLING_ROW])
    await getContracts({})
    expect(universeCalls().map((c) => c.where.facilityId)).toEqual(["fac-home"])
  })
})
