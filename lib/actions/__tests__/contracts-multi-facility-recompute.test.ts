import { describe, it, expect, vi, beforeEach } from "vitest"

// W2.A.1 H-B — Contract CRUD (create / update / delete) must invoke
// recomputeMatchStatusesForVendor once per unique facility the contract
// touches. Previously each of the 3 sites only recomputed for
// `session.facility.id`, so COG rows at OTHER facilities in a
// multi-facility contract stayed pending. This test pins the new
// behavior: given a contract linked to {session facility} ∪
// {contractFacilities[].facilityId}, we must see one recompute call
// per unique facility in that set.

const {
  createMock,
  updateMock,
  deleteMock,
  findUniqueOrThrowMock,
  findUniqueMock,
  findFirstMock,
  contractFacilityDeleteManyMock,
  contractFacilityCreateManyMock,
  recomputeMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  findUniqueOrThrowMock: vi.fn(),
  findUniqueMock: vi.fn(),
  findFirstMock: vi.fn().mockResolvedValue(null),
  contractFacilityDeleteManyMock: vi.fn(),
  contractFacilityCreateManyMock: vi.fn(),
  recomputeMock: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const prisma: Record<string, unknown> = {
    contract: {
      create: createMock,
      update: updateMock,
      delete: deleteMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
      findUnique: findUniqueMock,
      findFirst: findFirstMock,
    },
    contractFacility: {
      deleteMany: contractFacilityDeleteManyMock,
      createMany: contractFacilityCreateManyMock,
    },
    contractProductCategory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    contractAmortizationSchedule: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  prisma.$transaction = async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(fn as unknown[])
  return { prisma }
})

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-A" },
    user: { id: "u-1" },
  }),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: (...args: unknown[]) => recomputeMock(...args),
}))

vi.mock("@/lib/actions/contracts/scoring", () => ({
  recomputeContractScore: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import {
  createContract,
  updateContract,
  deleteContract,
} from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
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

const baseCreateInput = {
  name: "Arthrex Multi-Facility",
  vendorId: "v-arthrex",
  categoryIds: [],
  contractType: "usage" as const,
  status: "active" as const,
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  autoRenewal: false,
  terminationNoticeDays: 30,
  totalValue: 100000,
  annualValue: 100000,
  performancePeriod: "annual" as const,
  rebatePayPeriod: "quarterly" as const,
  isMultiFacility: true,
  facilityIds: [],
  additionalFacilityIds: ["fac-B", "fac-C"],
}

function pairKey(call: unknown[]): string {
  const arg = call[1] as { vendorId: string; facilityId: string }
  return `${arg.vendorId}|${arg.facilityId}`
}

describe("createContract — multi-facility recompute (W2.A.1 H-B)", () => {
  it("calls recompute for session facility + every additionalFacilityIds entry", async () => {
    createMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-arthrex",
      facilityId: "fac-A",
      contractFacilities: [],
    })

    await createContract(baseCreateInput)

    const invokedPairs = new Set(
      recomputeMock.mock.calls.map((call) => pairKey(call as unknown[])),
    )
    expect(invokedPairs).toEqual(
      new Set([
        "v-arthrex|fac-A",
        "v-arthrex|fac-B",
        "v-arthrex|fac-C",
      ]),
    )
    // No double-calls for the same pair.
    expect(recomputeMock.mock.calls.length).toBe(invokedPairs.size)
  })
})

describe("updateContract — multi-facility recompute (W2.A.1 H-B)", () => {
  it("calls recompute for every facility the contract touches (own + join-table)", async () => {
    findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
    updateMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-arthrex",
      facilityId: "fac-A",
      contractFacilities: [{ facilityId: "fac-B" }, { facilityId: "fac-C" }],
    })
    findUniqueMock.mockResolvedValue({
      facilityId: "fac-A",
      contractFacilities: [{ facilityId: "fac-B" }, { facilityId: "fac-C" }],
    })

    await updateContract("c-1", {
      name: "Renamed",
    })

    const invokedPairs = new Set(
      recomputeMock.mock.calls.map((call) => pairKey(call as unknown[])),
    )
    expect(invokedPairs).toEqual(
      new Set([
        "v-arthrex|fac-A",
        "v-arthrex|fac-B",
        "v-arthrex|fac-C",
      ]),
    )
    expect(recomputeMock.mock.calls.length).toBe(invokedPairs.size)
  })

  it("de-dupes when own-facility is also in the join-table", async () => {
    findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
    updateMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-arthrex",
      facilityId: "fac-A",
      contractFacilities: [{ facilityId: "fac-A" }, { facilityId: "fac-B" }],
    })
    findUniqueMock.mockResolvedValue({
      facilityId: "fac-A",
      contractFacilities: [{ facilityId: "fac-A" }, { facilityId: "fac-B" }],
    })

    await updateContract("c-1", { name: "Renamed" })

    const invokedPairs = new Set(
      recomputeMock.mock.calls.map((call) => pairKey(call as unknown[])),
    )
    expect(invokedPairs).toEqual(
      new Set(["v-arthrex|fac-A", "v-arthrex|fac-B"]),
    )
    expect(recomputeMock.mock.calls.length).toBe(2)
  })
})

describe("deleteContract — multi-facility recompute (W2.A.1 H-B)", () => {
  it("calls recompute for every facility the deleted contract touched", async () => {
    findUniqueOrThrowMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-arthrex",
      facilityId: "fac-A",
      contractFacilities: [{ facilityId: "fac-B" }, { facilityId: "fac-C" }],
    })
    deleteMock.mockResolvedValue({
      id: "c-1",
      vendorId: "v-arthrex",
      facilityId: "fac-A",
    })

    await deleteContract("c-1")

    const invokedPairs = new Set(
      recomputeMock.mock.calls.map((call) => pairKey(call as unknown[])),
    )
    expect(invokedPairs).toEqual(
      new Set([
        "v-arthrex|fac-A",
        "v-arthrex|fac-B",
        "v-arthrex|fac-C",
      ]),
    )
    expect(recomputeMock.mock.calls.length).toBe(invokedPairs.size)
  })
})
