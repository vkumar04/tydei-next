import { describe, it, expect, vi, beforeEach } from "vitest"

// Charles W1.W-E1 — double-click on "Create Contract" must create ONE
// contract row, not two. The server action accepts an idempotencyKey
// the client generates once per form session; a second call with the
// same key within the TTL returns the original contract instead of
// writing a duplicate row.

const {
  createMock,
  findUniqueOrThrowMock,
  logAuditMock,
  recomputeVendorMock,
  recomputeScoreMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  findUniqueOrThrowMock: vi.fn(),
  logAuditMock: vi.fn(),
  recomputeVendorMock: vi.fn(),
  recomputeScoreMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      create: createMock,
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

const baseInput = {
  name: "Idempotent Test",
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

beforeEach(() => {
  vi.clearAllMocks()
  idempotencyResetForTests()
  // Each call to prisma.contract.create returns a fresh id so we can
  // see how many writes actually hit prisma.
  let idCounter = 0
  createMock.mockImplementation(() => {
    idCounter += 1
    return Promise.resolve({
      id: `c-${idCounter}`,
      vendorId: "v-1",
    })
  })
  findUniqueOrThrowMock.mockResolvedValue({ id: "c-1" })
  recomputeVendorMock.mockResolvedValue(undefined)
  recomputeScoreMock.mockResolvedValue(undefined)
  logAuditMock.mockResolvedValue(undefined)
})

describe("createContract — idempotency key (W1.W-E1)", () => {
  it("writes exactly ONE contract row when called twice with the same idempotency key", async () => {
    const key = "client-session-key-001"

    const first = await createContract({ ...baseInput, idempotencyKey: key })
    const second = await createContract({ ...baseInput, idempotencyKey: key })

    expect(createMock).toHaveBeenCalledTimes(1)
    // Both callers get the same contract back — the second call is a
    // replay of the first, not a new row.
    expect(first).toEqual(second)
  })

  it("writes TWO contract rows when no idempotency key is supplied", async () => {
    await createContract(baseInput)
    await createContract(baseInput)

    // Without a key, the server can't dedupe — historically this was
    // the bug. The guard is the client-side `disabled={isPending}` and
    // the early-return in `handleSubmit`. Test documents existing
    // behavior so a future refactor doesn't silently "help".
    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it("writes TWO contract rows for different idempotency keys", async () => {
    await createContract({ ...baseInput, idempotencyKey: "key-a" })
    await createContract({ ...baseInput, idempotencyKey: "key-b" })

    expect(createMock).toHaveBeenCalledTimes(2)
  })

  it("does not double-log audit when the second call is a cached replay", async () => {
    const key = "replay-audit-check"
    await createContract({ ...baseInput, idempotencyKey: key })
    await createContract({ ...baseInput, idempotencyKey: key })

    expect(logAuditMock).toHaveBeenCalledTimes(1)
  })
})
