import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  createMock,
  updateMock,
  findUniqueOrThrowMock,
  contractFacilityDeleteManyMock,
  contractFacilityCreateManyMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findUniqueOrThrowMock: vi.fn(),
  contractFacilityDeleteManyMock: vi.fn(),
  contractFacilityCreateManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const prisma: Record<string, unknown> = {
    contract: {
      create: createMock,
      update: updateMock,
      // Charles W1.Y-B — soft-dedupe lookup. Default no-match so the
      // existing createContract/updateContract assertions still reach
      // prisma.contract.create / prisma.contract.update.
      findFirst: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: findUniqueOrThrowMock,
      // W2.A.1 H-B: updateContract re-reads the contract after update
      // to compute the multi-facility recompute set. Tests that touch
      // updateContract must mock this too.
      findUnique: vi.fn().mockResolvedValue({
        facilityId: "fac-1",
        contractFacilities: [],
      }),
    },
    contractFacility: {
      deleteMany: contractFacilityDeleteManyMock,
      createMany: contractFacilityCreateManyMock,
    },
    contractProductCategory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }
  // Bug 10: createContract now wraps its writes in prisma.$transaction.
  // The mock just runs the interactive callback with the same prisma
  // object (no isolation/rollback semantics — tests assert writes, not
  // atomicity).
  prisma.$transaction = async (fn: unknown) =>
    typeof fn === "function"
      ? (fn as (tx: typeof prisma) => Promise<unknown>)(prisma)
      : Promise.all(fn as unknown[])
  return { prisma }
})
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({
    facility: { id: "fac-1" },
    user: { id: "u-1" },
  }),
}))
vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/actions/contracts/scoring", () => ({
  recomputeContractScore: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
  revalidateTag: vi.fn(),
}))

import { createContract, updateContract } from "@/lib/actions/contracts"

beforeEach(() => {
  vi.clearAllMocks()
  createMock.mockResolvedValue({ id: "c-1", vendorId: "v-1" })
  updateMock.mockResolvedValue({ id: "c-1", vendorId: "v-1" })
  findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
  contractFacilityDeleteManyMock.mockResolvedValue({ count: 0 })
  contractFacilityCreateManyMock.mockResolvedValue({ count: 0 })
})

const baseCreateInput = {
  name: "Test Contract",
  vendorId: "v-1",
  categoryIds: [],
  contractType: "usage" as const,
  status: "active" as const,
  effectiveDate: "2026-01-01",
  expirationDate: "2027-01-01",
  autoRenewal: false,
  terminationNoticeDays: 30,
  totalValue: 1000,
  annualValue: 1000,
  performancePeriod: "annual" as const,
  rebatePayPeriod: "quarterly" as const,
  isMultiFacility: false,
  facilityIds: [],
}

describe("createContract — isGrouped persistence", () => {
  it("persists isGrouped=true when provided", async () => {
    await createContract({ ...baseCreateInput, isGrouped: true })
    const callData = createMock.mock.calls[0][0].data
    expect(callData.isGrouped).toBe(true)
  })

  it("defaults isGrouped to false when omitted", async () => {
    await createContract(baseCreateInput)
    const callData = createMock.mock.calls[0][0].data
    expect(callData.isGrouped).toBe(false)
  })
})

describe("updateContract — isGrouped persistence", () => {
  it("passes isGrouped=true through to prisma.contract.update", async () => {
    await updateContract("c-1", { isGrouped: true })
    const callData = updateMock.mock.calls[0][0].data
    expect(callData.isGrouped).toBe(true)
  })

  it("omits isGrouped when the field is not in the input", async () => {
    await updateContract("c-1", { name: "Renamed" })
    const callData = updateMock.mock.calls[0][0].data
    expect(callData.isGrouped).toBeUndefined()
  })
})

// Charles R5.36 P0 — regression guards that every basic-info field
// the edit form can touch is actually written to prisma. If any branch
// in `updateContract` silently drops a field (e.g. forgot to translate
// from input to `updateData`), the UI "save → reload shows old value"
// bug recurs.
describe("updateContract — every input field reaches prisma (R5.36 P0)", () => {
  it("persists a full basic-info payload into prisma.contract.update", async () => {
    await updateContract("c-1", {
      name: "New Name",
      contractNumber: "CN-42",
      description: "new description",
      notes: "new notes",
      gpoAffiliation: "Vizient",
      totalValue: 555_000,
      annualValue: 250_000,
      autoRenewal: true,
      terminationNoticeDays: 60,
      effectiveDate: "2026-05-01",
      expirationDate: "2028-05-01",
      performancePeriod: "monthly",
      rebatePayPeriod: "annual",
      status: "active",
      contractType: "usage",
    })
    const callData = updateMock.mock.calls[0][0].data
    expect(callData.name).toBe("New Name")
    expect(callData.contractNumber).toBe("CN-42")
    expect(callData.description).toBe("new description")
    expect(callData.notes).toBe("new notes")
    expect(callData.gpoAffiliation).toBe("Vizient")
    expect(callData.totalValue).toBe(555_000)
    expect(callData.annualValue).toBe(250_000)
    expect(callData.autoRenewal).toBe(true)
    expect(callData.terminationNoticeDays).toBe(60)
    expect(callData.effectiveDate).toEqual(new Date("2026-05-01"))
    expect(callData.expirationDate).toEqual(new Date("2028-05-01"))
    expect(callData.performancePeriod).toBe("monthly")
    expect(callData.rebatePayPeriod).toBe("annual")
    expect(callData.status).toBe("active")
    expect(callData.contractType).toBe("usage")
  })

  it("returns the updated contract so the mutation onSuccess can rely on fresh data", async () => {
    updateMock.mockResolvedValueOnce({
      id: "c-1",
      vendorId: "v-1",
      description: "persisted",
    })
    const out = await updateContract("c-1", { description: "persisted" })
    expect((out as { description?: string }).description).toBe("persisted")
  })
})
