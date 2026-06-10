/**
 * Smoke tests for the canonical vendor-reports actions
 * (`getVendorRebateStatement`, `getVendorPerformanceSummary`,
 * `getVendorContractRoster`). Each test pins the row shape + the
 * canonical-helper math (window vs lifetime) so a future drift in
 * `sumEarnedRebatesLifetime` / `sumCollectedRebates` ripples here
 * deterministically instead of silently disagreeing with the
 * contract-detail header card.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type ContractRow = {
  id: string
  name?: string
  contractNumber?: string | null
  status?: string
  effectiveDate?: Date
  expirationDate?: Date
  facilityId?: string
  facility?: { id: string; name: string } | null
  annualValue?: number | null
  totalValue?: number | null
  currentMarketShare?: number | null
  periods?: Array<{ totalSpend: number }>
  rebates?: Array<{
    rebateEarned: number
    rebateCollected: number
    payPeriodEnd: Date | null
    collectionDate: Date | null
  }>
  terms?: Array<{ rebateMethod: string }>
}

let contractFindMany: ContractRow[] = []
let cogGroupBy: Array<{
  contractId: string | null
  _sum: { extendedPrice: number | null }
}> = []
// Trailing-12mo per-facility spend — numerator of the canonical
// compliance definition (getVendorPerformanceSummary groupBy(facilityId)).
let cogGroupByFacility: Array<{
  facilityId: string | null
  _sum: { extendedPrice: number | null }
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findMany: vi.fn(async () => contractFindMany),
    },
    cOGRecord: {
      groupBy: vi.fn(async (args: { by: string[] }) =>
        args.by.includes("facilityId") ? cogGroupByFacility : cogGroupBy,
      ),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: vi.fn(async () => ({
    vendor: { id: "v-1" },
    user: { id: "u-1" },
  })),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

beforeEach(() => {
  vi.clearAllMocks()
  contractFindMany = []
  cogGroupBy = []
  cogGroupByFacility = []
})

describe("getVendorRebateStatement", () => {
  it("returns per-contract rows with window-scoped earned/collected + lifetime outstanding", async () => {
    contractFindMany = [
      {
        id: "c-1",
        name: "Joint Replacement",
        facility: { id: "f-1", name: "Lighthouse" },
        rebates: [
          // Inside window, closed → counts toward earnedThisPeriod.
          {
            rebateEarned: 100,
            rebateCollected: 0,
            payPeriodEnd: new Date("2026-02-15"),
            collectionDate: null,
          },
          // Inside window, collected → counts toward collectedThisPeriod
          // AND lifetime collected.
          {
            rebateEarned: 0,
            rebateCollected: 80,
            payPeriodEnd: new Date("2026-01-31"),
            collectionDate: new Date("2026-02-20"),
          },
          // Outside window — contributes to lifetime earned only.
          {
            rebateEarned: 50,
            rebateCollected: 0,
            payPeriodEnd: new Date("2025-12-31"),
            collectionDate: null,
          },
        ],
      },
    ]

    const { getVendorRebateStatement } = await import(
      "@/lib/actions/vendor-reports"
    )
    const rows = await getVendorRebateStatement("2026-01-01", "2026-03-31")

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      contractId: "c-1",
      contractName: "Joint Replacement",
      facilityName: "Lighthouse",
      earnedThisPeriod: 100,
      collectedThisPeriod: 80,
      // lifetime earned (150) - lifetime collected (80) = 70.
      outstanding: 70,
    })
  })
})

describe("getVendorPerformanceSummary", () => {
  it("rolls multiple contracts up by facility with canonical compliance + averaged share", async () => {
    contractFindMany = [
      {
        id: "c-1",
        facilityId: "f-1",
        facility: { id: "f-1", name: "Lighthouse" },
        status: "active",
        annualValue: 10000,
        currentMarketShare: 60,
        periods: [{ totalSpend: 1000 }],
        rebates: [
          {
            rebateEarned: 25,
            rebateCollected: 25,
            payPeriodEnd: new Date("2026-02-15"),
            collectionDate: new Date("2026-02-20"),
          },
        ],
      },
      {
        id: "c-2",
        facilityId: "f-1",
        facility: { id: "f-1", name: "Lighthouse" },
        // Expired → its target must NOT enter the compliance denominator.
        status: "expired",
        annualValue: 99999,
        currentMarketShare: 40,
        periods: [{ totalSpend: 500 }],
        rebates: [],
      },
    ]
    // No COG fallback needed (period spend > 0).
    cogGroupBy = []
    // Trailing-12mo vendor COG at the facility — canonical compliance
    // numerator (computeVendorCompliance: 7,500 / 10,000 = 75%).
    cogGroupByFacility = [
      { facilityId: "f-1", _sum: { extendedPrice: 7500 } },
    ]

    const { getVendorPerformanceSummary } = await import(
      "@/lib/actions/vendor-reports"
    )
    const rows = await getVendorPerformanceSummary("2026-01-01", "2026-03-31")

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      facilityId: "f-1",
      facilityName: "Lighthouse",
      spend: 1500,
      earned: 25,
      collected: 25,
      // Canonical definition (lib/contracts/vendor-compliance.ts):
      // trailing-12mo spend / Σ active-contract targets — NOT an
      // average of the persisted match-compliance Contract.complianceRate.
      compliancePercent: 75,
      marketSharePercent: 50, // (60 + 40) / 2
    })
  })

  it("falls back to COG when ContractPeriod has no rows in window", async () => {
    contractFindMany = [
      {
        id: "c-1",
        facilityId: "f-1",
        facility: { id: "f-1", name: "Lighthouse" },
        status: "active",
        annualValue: null,
        totalValue: null,
        currentMarketShare: null,
        periods: [],
        rebates: [],
      },
    ]
    cogGroupBy = [
      { contractId: "c-1", _sum: { extendedPrice: 5000 } },
    ]

    const { getVendorPerformanceSummary } = await import(
      "@/lib/actions/vendor-reports"
    )
    const rows = await getVendorPerformanceSummary("2026-01-01", "2026-03-31")
    expect(rows[0].spend).toBe(5000)
  })
})

describe("getVendorContractRoster", () => {
  it("returns contract rows with key terms + lifetime/YTD earned + last activity", async () => {
    const today = new Date()
    const lastActivity = new Date(today.getFullYear(), 1, 28) // Feb 28 of this year
    contractFindMany = [
      {
        id: "c-1",
        name: "Joint Replacement",
        contractNumber: "JR-001",
        status: "active",
        effectiveDate: new Date(today.getFullYear() - 1, 0, 1),
        expirationDate: new Date(today.getFullYear(), 11, 31),
        facility: { id: "f-1", name: "Lighthouse" },
        terms: [{ rebateMethod: "cumulative" }],
        rebates: [
          {
            rebateEarned: 100,
            rebateCollected: 0,
            payPeriodEnd: lastActivity,
            collectionDate: null,
          },
          // Prior-year row → contributes to lifetime, NOT to YTD.
          {
            rebateEarned: 200,
            rebateCollected: 0,
            payPeriodEnd: new Date(today.getFullYear() - 1, 6, 30),
            collectionDate: null,
          },
        ],
      },
    ]

    const { getVendorContractRoster } = await import(
      "@/lib/actions/vendor-reports"
    )
    const rows = await getVendorContractRoster()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      contractId: "c-1",
      contractName: "Joint Replacement",
      contractNumber: "JR-001",
      facilityName: "Lighthouse",
      status: "active",
      rebateMethod: "cumulative",
      rebateEarnedYTD: 100,
      rebateEarnedLifetime: 300,
    })
    expect(rows[0].lastActivity).toEqual(lastActivity)
  })

  it("emits '—' for rebateMethod when the contract has no terms", async () => {
    contractFindMany = [
      {
        id: "c-1",
        name: "Empty",
        contractNumber: null,
        status: "draft",
        effectiveDate: new Date("2026-01-01"),
        expirationDate: new Date("2026-12-31"),
        facility: null,
        terms: [],
        rebates: [],
      },
    ]
    const { getVendorContractRoster } = await import(
      "@/lib/actions/vendor-reports"
    )
    const rows = await getVendorContractRoster()
    expect(rows[0].rebateMethod).toBe("—")
    expect(rows[0].facilityName).toBe("Unattributed")
    expect(rows[0].lastActivity).toBeNull()
  })
})
