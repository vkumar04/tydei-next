import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  createMock,
  updateMock,
  findFirstMock,
  findUniqueOrThrowMock,
  contractFacilityDeleteManyMock,
  contractFacilityCreateManyMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  updateMock: vi.fn(),
  findFirstMock: vi.fn(),
  findUniqueOrThrowMock: vi.fn(),
  contractFacilityDeleteManyMock: vi.fn(),
  contractFacilityCreateManyMock: vi.fn(),
}))

vi.mock("@/lib/db", () => {
  const prisma: Record<string, unknown> = {
    contract: {
      create: createMock,
      update: updateMock,
      // Charles W1.Y-B — soft-dedupe lookup. Default no-match (set in
      // beforeEach) so the existing createContract/updateContract
      // assertions still reach prisma.contract.create / .update. The
      // B1 dedupe-window tests override it per-test.
      findFirst: findFirstMock,
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
vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))

import { createContract, updateContract } from "@/lib/actions/contracts"
import { idempotencyResetForTests } from "@/lib/idempotency"

beforeEach(() => {
  vi.clearAllMocks()
  // The in-memory idempotency cache is module-global real code (not
  // mocked) — drop entries so the B1 cache tests can't leak across tests.
  idempotencyResetForTests()
  findFirstMock.mockResolvedValue(null)
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

// bugs.rtfd 2026-06-11 B1 — Create Contract pauses for a long post-create
// pricing-file import (120s transaction timeout in pricing-files.ts). The
// old 30s dedupe windows (in-memory idempotency TTL + DB soft-dedupe)
// both expired mid-import, so a second click created a duplicate
// contract. Both windows must cover the import plus margin (180s).
describe("createContract dedupe window (bugs.rtfd 2026-06-11 B1)", () => {
  it("DB soft-dedupe: a duplicate submit 90s after the original returns the ORIGINAL contract — prisma create not called", async () => {
    const original = {
      id: "c-original",
      vendorId: "v-1",
      facilityId: "fac-1",
      name: "Test Contract",
      effectiveDate: new Date("2026-01-01"),
      createdAt: new Date(Date.now() - 90_000),
    }
    // The mock evaluates the window bound the action sends down: the
    // 90s-old original is only found if `createdAt.gte` reaches at
    // least 90s back. With the old 30s window this returns null and
    // the action writes a duplicate row — the bug.
    findFirstMock.mockImplementation(
      async (args: { where: { createdAt: { gte: Date } } }) =>
        original.createdAt >= args.where.createdAt.gte ? original : null,
    )

    const out = await createContract(baseCreateInput)

    expect((out as { id: string }).id).toBe("c-original")
    expect(createMock).not.toHaveBeenCalled()
  })

  it("in-memory idempotency: a same-key resubmit 90s later replays the cached contract — prisma create called once", async () => {
    const t0 = Date.now()
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(t0)
    try {
      const first = await createContract({
        ...baseCreateInput,
        idempotencyKey: "b1-key-1",
      })
      expect(createMock).toHaveBeenCalledTimes(1)

      // 90s later — mid pricing import under the old 30s TTL.
      nowSpy.mockReturnValue(t0 + 90_000)
      const second = await createContract({
        ...baseCreateInput,
        idempotencyKey: "b1-key-1",
      })

      expect((second as { id: string }).id).toBe(
        (first as { id: string }).id,
      )
      expect(createMock).toHaveBeenCalledTimes(1)
    } finally {
      nowSpy.mockRestore()
    }
  })
})
