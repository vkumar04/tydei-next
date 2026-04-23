import { describe, it, expect, vi, beforeEach } from "vitest"

// W2.A.1 H-F — seeds must invoke recomputeMatchStatusesForVendor for
// every distinct (vendorId, facilityId) pair they create, otherwise
// freshly-seeded rows sit at matchStatus=pending forever and no UI
// surface ever shows on_contract / price_variance coverage.

const { recomputeMock } = vi.hoisted(() => ({
  recomputeMock: vi.fn(),
}))

vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))

// seedCOGForContracts also imports rebate math helpers. Keep them real
// (they don't touch the DB), just mock the contract-definitions helper
// to always return true so the test exercises the rebate path.
import { seedCOGRecords } from "../cog-records"
import { seedCOGForContracts } from "../cog-for-contracts"

beforeEach(() => {
  recomputeMock.mockReset()
  recomputeMock.mockResolvedValue({
    total: 0,
    updated: 0,
    onContract: 0,
    priceVariance: 0,
    offContract: 0,
    outOfScope: 0,
    unknownVendor: 0,
  })
})

function makeFakePrisma() {
  const created: Array<{ facilityId: string; vendorId: string; vendorItemNo: string }> = []
  const prisma = {
    cOGRecord: {
      create: vi.fn(async ({ data }: { data: { facilityId: string; vendorId: string; vendorItemNo: string } }) => {
        created.push({
          facilityId: data.facilityId,
          vendorId: data.vendorId,
          vendorItemNo: data.vendorItemNo,
        })
        return { id: `cog-${created.length}`, ...data }
      }),
      createMany: vi.fn(
        async ({ data }: { data: Array<{ facilityId: string; vendorId: string; vendorItemNo: string }> }) => {
          for (const row of data) {
            created.push({
              facilityId: row.facilityId,
              vendorId: row.vendorId,
              vendorItemNo: row.vendorItemNo,
            })
          }
          return { count: data.length }
        },
      ),
    },
    contract: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    contractPeriod: {
      create: vi.fn(async ({ data }: { data: unknown }) => ({ id: "p-1", ...(data as object) })),
    },
    rebate: {
      create: vi.fn(async ({ data }: { data: unknown }) => ({ id: "r-1", ...(data as object) })),
    },
  }
  return { prisma, created }
}

describe("seedCOGRecords — post-seed recompute (W2.A.1 H-F)", () => {
  it("invokes recomputeMatchStatusesForVendor once per distinct (vendorId, facilityId) pair", async () => {
    const { prisma, created } = makeFakePrisma()

    // Minimal facility / vendor fixtures that satisfy seedCOGRecords's
    // hard-coded reference set. The shape matches what the seed
    // destructures ({ facilityId: f.x.id, vendorId: v.x.id }).
    const f = {
      lighthouseSurgical: { id: "fac-LS" },
      lighthouseCommunity: { id: "fac-LC" },
      heritageRegional: { id: "fac-HR" },
      austinSpine: { id: "fac-AS" },
      summitGeneral: { id: "fac-SG" },
      rockyMountain: { id: "fac-RM" },
      portlandOrtho: { id: "fac-PO" },
      heritagePediatrics: { id: "fac-HP" },
    }
    const v = {
      stryker: { id: "v-stryker" },
      medtronic: { id: "v-medtronic" },
      smithNephew: { id: "v-sn" },
      arthrex: { id: "v-arthrex" },
      depuySynthes: { id: "v-dps" },
      zimmerBiomet: { id: "v-zb" },
      integra: { id: "v-integra" },
      conmed: { id: "v-conmed" },
      nuvasive: { id: "v-nuv" },
      hologic: { id: "v-hologic" },
    }

    // @ts-expect-error — fake prisma shape is narrower than PrismaClient
    // but covers every call the seed actually makes.
    await seedCOGRecords(prisma, {
      facilities: f,
      vendors: v,
    })

    // The seed inserted at least one row — derive the expected unique
    // (vendor, facility) pair set from what was actually created.
    expect(created.length).toBeGreaterThan(0)
    const uniquePairs = new Set(
      created.map((r) => `${r.vendorId}|${r.facilityId}`),
    )
    expect(recomputeMock).toHaveBeenCalledTimes(uniquePairs.size)

    // Every call must use the (prisma, { vendorId, facilityId }) shape.
    for (const call of recomputeMock.mock.calls) {
      const [db, arg] = call as [
        unknown,
        { vendorId: string; facilityId: string },
      ]
      expect(db).toBe(prisma)
      expect(typeof arg.vendorId).toBe("string")
      expect(typeof arg.facilityId).toBe("string")
    }

    // Each unique pair should appear exactly once in the call list.
    const invokedPairs = new Set(
      recomputeMock.mock.calls.map((call) => {
        const arg = (call as unknown[])[1] as {
          vendorId: string
          facilityId: string
        }
        return `${arg.vendorId}|${arg.facilityId}`
      }),
    )
    expect(invokedPairs).toEqual(uniquePairs)
  })
})

describe("seedCOGForContracts — post-seed recompute (W2.A.1 H-F)", () => {
  it("invokes recomputeMatchStatusesForVendor for each (vendor × facility) pair created", async () => {
    const { prisma, created } = makeFakePrisma()

    // One active contract with pricing items + facility links.
    prisma.contract.findMany.mockResolvedValueOnce([
      {
        id: "c-1",
        vendorId: "v-stryker",
        vendorName: "Stryker",
        vendor: { id: "v-stryker", name: "Stryker" },
        contractType: "rebate",
        facilityId: "fac-LS",
        effectiveDate: new Date("2026-01-01"),
        expirationDate: new Date("2026-12-31"),
        contractFacilities: [{ facilityId: "fac-LC" }],
        terms: [
          {
            tiers: [
              { tierNumber: 1, spendMin: 100000, rebateValue: 0.02 },
            ],
          },
        ],
      },
    ])

    // @ts-expect-error — fake prisma shape
    await seedCOGForContracts(prisma)

    expect(created.length).toBeGreaterThan(0)
    const uniquePairs = new Set(
      created.map((r) => `${r.vendorId}|${r.facilityId}`),
    )
    // At least the two facilities should have been hit.
    expect(uniquePairs.size).toBeGreaterThanOrEqual(2)
    expect(recomputeMock).toHaveBeenCalledTimes(uniquePairs.size)

    const invokedPairs = new Set(
      recomputeMock.mock.calls.map((call) => {
        const arg = (call as unknown[])[1] as {
          vendorId: string
          facilityId: string
        }
        return `${arg.vendorId}|${arg.facilityId}`
      }),
    )
    expect(invokedPairs).toEqual(uniquePairs)
  })
})
