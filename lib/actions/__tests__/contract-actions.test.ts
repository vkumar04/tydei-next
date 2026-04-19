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

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      create: createMock,
      update: updateMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
    },
    contractFacility: {
      deleteMany: contractFacilityDeleteManyMock,
      createMany: contractFacilityCreateManyMock,
    },
    contractProductCategory: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}))
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
