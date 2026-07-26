import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * `getContractPeriodData` must not return another tenant's financials.
 *
 * Found in the 2026-07-26 security audit and confirmed exploitable against
 * seeded data before the fix. The action was:
 *
 *     await requireFacility()                    // caller is SOME facility user
 *     const where = { contractId }               // straight off the wire
 *     const periods = await prisma.contractPeriod.findMany({ where })
 *     return serialize(periods.map(...))         // and handed back
 *
 * `requireFacility()` proves the caller is a facility user; it says nothing
 * about WHICH facility owns `contractId`. So any authenticated facility user
 * could read any other tenant's ContractPeriod rows — totalSpend,
 * rebateEarned, rebateCollected, paymentActual, tierAchieved. Reproduced
 * cross-tenant against the local seed:
 *
 *     contract owner facility: cms1z7kos...  caller facility: cms1z7koo...  same? false
 *     rows returned to a NON-owner: 2
 *       2024-07-01 spend= 16666.67 rebateEarned= 3.33 rebateCollected= 2.67
 *
 * The auth-scope scanner did not catch it, for two reasons worth remembering:
 *   - `findMany` is not in its RISKY_OPS list (only single-row ops are), and
 *   - it looks for a LITERAL `where: { id ... }`, while this built the where
 *     clause as a variable and passed it by reference.
 * Both gaps are still open for other call sites; this test pins the one that
 * was actually leaking.
 */

const contractFindFirst = vi.fn()
const periodFindMany = vi.fn()

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi
    .fn()
    .mockResolvedValue({ facility: { id: "fac-mine", name: "Mine" } }),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { get findFirst() { return contractFindFirst } },
    contractPeriod: { get findMany() { return periodFindMany } },
  },
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))
vi.mock("@/lib/actions/contract-periods", () => ({
  computeSyntheticContractPeriods: vi.fn(),
}))
vi.mock("@/lib/actions/contracts/tie-in", () => ({
  getContractCapitalSchedule: vi.fn(),
}))
vi.mock("@/lib/reports/report-data-core", () => ({ buildReportDataRows: vi.fn() }))

import { getContractPeriodData } from "@/lib/actions/reports"

const FOREIGN_PERIODS = [
  {
    id: "p1",
    periodStart: new Date("2024-07-01"),
    periodEnd: new Date("2024-07-31"),
    totalSpend: 16666.67,
    totalVolume: 10,
    rebateEarned: 3.33,
    rebateCollected: 2.67,
    paymentExpected: 0,
    paymentActual: 0,
    tierAchieved: 1,
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  periodFindMany.mockResolvedValue(FOREIGN_PERIODS)
})

describe("getContractPeriodData tenant scoping", () => {
  it("returns nothing for a contract the caller's facility does not own", async () => {
    // Ownership probe finds no row -> the contract belongs to someone else.
    contractFindFirst.mockResolvedValueOnce(null)

    const result = await getContractPeriodData({ contractId: "someone-elses" })

    expect(
      result,
      "another tenant's spend and rebate figures must never come back",
    ).toEqual([])
    expect(
      periodFindMany,
      "the period query should not even run for a non-owned contract",
    ).not.toHaveBeenCalled()
  })

  it("checks ownership through the canonical helper, not a bare id", async () => {
    contractFindFirst.mockResolvedValueOnce({ id: "c1" })
    await getContractPeriodData({ contractId: "c1" })

    expect(contractFindFirst).toHaveBeenCalledTimes(1)
    const where = contractFindFirst.mock.calls[0][0].where
    // contractOwnershipWhere covers the primary facilityId AND the
    // multi-facility join, so a shared contract stays readable.
    expect(JSON.stringify(where)).toContain("fac-mine")
  })

  it("returns the periods for a contract the facility does own", async () => {
    contractFindFirst.mockResolvedValueOnce({ id: "c1" })

    const result = (await getContractPeriodData({
      contractId: "c1",
    })) as { rebateEarned: number }[]

    expect(periodFindMany).toHaveBeenCalledTimes(1)
    expect(result).toHaveLength(1)
    expect(result[0].rebateEarned).toBe(3.33)
  })

  it("still applies the date window on an owned contract", async () => {
    contractFindFirst.mockResolvedValueOnce({ id: "c1" })
    await getContractPeriodData({
      contractId: "c1",
      dateFrom: "2024-01-01",
      dateTo: "2024-12-31",
    })
    const where = periodFindMany.mock.calls[0][0].where
    expect(where.contractId).toBe("c1")
    expect(where.periodStart).toBeDefined()
    expect(where.periodEnd).toBeDefined()
  })
})
