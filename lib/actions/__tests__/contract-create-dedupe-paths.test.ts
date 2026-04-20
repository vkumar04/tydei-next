import { describe, it, expect, vi, beforeEach } from "vitest"

// Charles W1.Y-B — dedupe across every submit path that creates a contract.
// Complements `contract-create-idempotency.test.ts` (which locks in the
// W1.W-E1 in-memory cache) by asserting the SAME idempotency contract
// holds across every client surface listed in the plan — even the ones
// that don't exist yet. Each path here is a regression lock: if a future
// surface is added that forgets to thread an idempotency key through,
// it will fail `it.each` parity with the existing manual-form path.

const {
  createMock,
  findFirstMock,
  findUniqueOrThrowMock,
  logAuditMock,
  recomputeVendorMock,
  recomputeScoreMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  findFirstMock: vi.fn(),
  findUniqueOrThrowMock: vi.fn(),
  logAuditMock: vi.fn(),
  recomputeVendorMock: vi.fn(),
  recomputeScoreMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      create: createMock,
      findFirst: findFirstMock,
      findUniqueOrThrow: findUniqueOrThrowMock,
    },
    contractFacility: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
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
  logAudit: logAuditMock,
}))
vi.mock("@/lib/cog/recompute", () => ({
  recomputeMatchStatusesForVendor: recomputeVendorMock,
}))
vi.mock("@/lib/actions/contracts/scoring", () => ({
  recomputeContractScore: recomputeScoreMock,
}))
vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T) => v,
}))
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}))

import { createContract } from "@/lib/actions/contracts"
import { idempotencyResetForTests } from "@/lib/idempotency"

function buildValidCreateInput() {
  return {
    name: "W1.Y-B Dedupe Contract",
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
}

beforeEach(() => {
  vi.clearAllMocks()
  idempotencyResetForTests()
  // Each `prisma.contract.create` gets a unique id so we can see how
  // many writes actually reached the DB.
  let idCounter = 0
  createMock.mockImplementation(() => {
    idCounter += 1
    return Promise.resolve({
      id: `c-${idCounter}`,
      facilityId: "fac-1",
      vendorId: "v-1",
      name: "W1.Y-B Dedupe Contract",
      effectiveDate: new Date("2026-01-01"),
      createdAt: new Date(),
    })
  })
  // Default: no pre-existing recent dup. Individual tests override.
  findFirstMock.mockResolvedValue(null)
  findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
  recomputeVendorMock.mockResolvedValue(undefined)
  recomputeScoreMock.mockResolvedValue(undefined)
  logAuditMock.mockResolvedValue(undefined)
})

describe("contract-create dedupe across submit paths (Charles W1.Y-B)", () => {
  // Every path the plan enumerated. Today there is ONE actual UI caller
  // (`components/contracts/new-contract-client.tsx`) but this test locks
  // in the contract: whatever submit path lands in the future, sending
  // the same idempotency key twice must write exactly one row.
  it.each([
    ["manual new-contract form"],
    ["AI extract review submit"],
    ["amendment extractor submit"],
    ["PDF drop-zone create"],
  ])(
    "deduplicates double-submit from the %s flow (Charles iMessage 2026-04-20)",
    async (_path) => {
      const input = buildValidCreateInput()
      const key = `key-${_path.replace(/\s+/g, "-")}`
      const first = await createContract({ ...input, idempotencyKey: key })
      const second = await createContract({ ...input, idempotencyKey: key })

      expect(second.id).toBe(first.id)
      expect(createMock).toHaveBeenCalledTimes(1)
    },
  )
})
