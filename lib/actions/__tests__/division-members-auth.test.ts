import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@/lib/generated/prisma/client"

/**
 * IDOR + permission-gate coverage for vendor division-member CRUD
 * (`lib/actions/division-members.ts`).
 *
 * Two invariants per action:
 *   1. write is gated by `requireCan("members.manage")` (only Super passes);
 *      when it throws, NO prisma write may run.
 *   2. every write is scoped to the caller's OWN vendor — division ids and
 *      user ids from the client are re-verified server-side before any
 *      mutation; a foreign id is rejected (count 0 or guard miss), never a
 *      bare `where: { id }`.
 *
 * `attachUserToDivision` additionally re-verifies the target user is a
 * member of the caller's vendor org (cross-tenant attach guard), inside a
 * `$transaction`. We invoke the txn callback with a mock `tx` exposing the
 * three models the source touches.
 */

const {
  divisionCreateMock,
  divisionUpdateManyMock,
  divisionDeleteManyMock,
  divisionFindFirstOrThrowMock,
  txDivisionFindFirstMock,
  txMemberFindFirstMock,
  txDivisionMemberUpsertMock,
  txDivisionMemberDeleteManyMock,
  transactionMock,
} = vi.hoisted(() => ({
  divisionCreateMock: vi.fn(),
  divisionUpdateManyMock: vi.fn(),
  divisionDeleteManyMock: vi.fn(),
  divisionFindFirstOrThrowMock: vi.fn(),
  txDivisionFindFirstMock: vi.fn(),
  txMemberFindFirstMock: vi.fn(),
  txDivisionMemberUpsertMock: vi.fn(),
  txDivisionMemberDeleteManyMock: vi.fn(),
  transactionMock: vi.fn(),
}))

const { requireVendorMock } = vi.hoisted(() => ({
  requireVendorMock: vi.fn(),
}))

const { requireCanMock } = vi.hoisted(() => ({
  requireCanMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    vendorDivision: {
      create: divisionCreateMock,
      updateMany: divisionUpdateManyMock,
      deleteMany: divisionDeleteManyMock,
      findFirstOrThrow: divisionFindFirstOrThrowMock,
    },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
}))

vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCan: requireCanMock,
}))

vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import {
  createVendorDivision,
  updateVendorDivision,
  deleteVendorDivision,
  attachUserToDivision,
  detachUserFromDivision,
} from "@/lib/actions/division-members"

// A `tx` object exposing exactly the models the source reaches for inside
// `$transaction`. `transactionMock` invokes its callback with this object.
const tx = {
  vendorDivision: { findFirst: txDivisionFindFirstMock },
  member: { findFirst: txMemberFindFirstMock },
  divisionMember: {
    upsert: txDivisionMemberUpsertMock,
    deleteMany: txDivisionMemberDeleteManyMock,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: "vendor-caller", organizationId: "org-caller" },
  })
  requireCanMock.mockResolvedValue(undefined)
  transactionMock.mockImplementation(
    async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  )
})

const PERM = "members.manage"

describe("createVendorDivision", () => {
  it("blocks the write when requireCan('members.manage') throws (non-Super)", async () => {
    requireCanMock.mockRejectedValue(new Error("Forbidden"))

    await expect(
      createVendorDivision({ name: "West", code: "WST" }),
    ).rejects.toThrow()

    expect(requireCanMock).toHaveBeenCalledWith(PERM)
    expect(divisionCreateMock).not.toHaveBeenCalled()
  })

  it("writes vendorId from the SESSION, never client-supplied", async () => {
    divisionCreateMock.mockResolvedValue({
      id: "div-1",
      name: "West",
      code: "WST",
      categories: [],
      isDefault: false,
    })

    const result = await createVendorDivision({
      name: "West",
      code: "WST",
      categories: ["Cardiac"],
    })

    expect(divisionCreateMock).toHaveBeenCalledOnce()
    const data = divisionCreateMock.mock.calls[0][0].data as Record<
      string,
      unknown
    >
    expect(data.vendorId).toBe("vendor-caller")
    expect(result.members).toEqual([])
  })

  it("catches a P2002 unique violation and rethrows a friendly message", async () => {
    divisionCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    )

    await expect(
      createVendorDivision({ name: "West", code: "DUP" }),
    ).rejects.toThrow(/A division with code "DUP" already exists/)
  })
})

describe("updateVendorDivision", () => {
  it("blocks the write when requireCan throws (non-Super)", async () => {
    requireCanMock.mockRejectedValue(new Error("Forbidden"))

    await expect(
      updateVendorDivision({ id: "div-1", name: "West", code: "WST" }),
    ).rejects.toThrow()

    expect(divisionUpdateManyMock).not.toHaveBeenCalled()
  })

  it("scopes updateMany to { id, vendorId } (caller's vendor)", async () => {
    divisionUpdateManyMock.mockResolvedValue({ count: 1 })
    divisionFindFirstOrThrowMock.mockResolvedValue({
      id: "div-1",
      name: "West",
      code: "WST",
      categories: [],
      isDefault: false,
      members: [],
    })

    await updateVendorDivision({ id: "div-1", name: "West", code: "WST" })

    const where = divisionUpdateManyMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({ id: "div-1", vendorId: "vendor-caller" })
  })

  it("throws 'Division not found' on a foreign id (count 0) — no re-read", async () => {
    divisionUpdateManyMock.mockResolvedValue({ count: 0 })

    await expect(
      updateVendorDivision({ id: "div-foreign", name: "X", code: "Y" }),
    ).rejects.toThrow(/Division not found/)

    expect(divisionFindFirstOrThrowMock).not.toHaveBeenCalled()
  })

  it("catches a P2002 unique violation and rethrows a friendly message", async () => {
    divisionUpdateManyMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    )

    await expect(
      updateVendorDivision({ id: "div-1", name: "West", code: "DUP" }),
    ).rejects.toThrow(/A division with code "DUP" already exists/)
  })
})

describe("deleteVendorDivision", () => {
  it("blocks the delete when requireCan throws (non-Super)", async () => {
    requireCanMock.mockRejectedValue(new Error("Forbidden"))

    await expect(deleteVendorDivision("div-1")).rejects.toThrow()

    expect(divisionDeleteManyMock).not.toHaveBeenCalled()
  })

  it("scopes deleteMany to { id, vendorId } (caller's vendor)", async () => {
    divisionDeleteManyMock.mockResolvedValue({ count: 1 })

    await deleteVendorDivision("div-1")

    const where = divisionDeleteManyMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({ id: "div-1", vendorId: "vendor-caller" })
  })

  it("throws 'Division not found' on a foreign id (count 0)", async () => {
    divisionDeleteManyMock.mockResolvedValue({ count: 0 })

    await expect(deleteVendorDivision("div-foreign")).rejects.toThrow(
      /Division not found/,
    )
  })
})

describe("attachUserToDivision", () => {
  it("blocks the attach when requireCan throws (non-Super)", async () => {
    requireCanMock.mockRejectedValue(new Error("Forbidden"))

    await expect(
      attachUserToDivision("div-1", "user-1"),
    ).rejects.toThrow()

    expect(transactionMock).not.toHaveBeenCalled()
    expect(txDivisionMemberUpsertMock).not.toHaveBeenCalled()
  })

  it("happy path: upserts once when both guards pass", async () => {
    txDivisionFindFirstMock.mockResolvedValue({ id: "div-1" }) // division owned
    txMemberFindFirstMock.mockResolvedValue({ id: "mem-1" }) // user is member
    txDivisionMemberUpsertMock.mockResolvedValue({})

    await attachUserToDivision("div-1", "user-1")

    // Guard 1 scoped to caller's vendor.
    expect(txDivisionFindFirstMock.mock.calls[0][0].where).toEqual({
      id: "div-1",
      vendorId: "vendor-caller",
    })
    // Guard 2 scoped to caller's org.
    expect(txMemberFindFirstMock.mock.calls[0][0].where).toEqual({
      userId: "user-1",
      organizationId: "org-caller",
    })
    expect(txDivisionMemberUpsertMock).toHaveBeenCalledOnce()
    expect(txDivisionMemberUpsertMock.mock.calls[0][0].where).toEqual({
      divisionId_userId: { divisionId: "div-1", userId: "user-1" },
    })
  })

  it("IDOR: rejects a cross-tenant division id (guard 1 miss) — no upsert", async () => {
    txDivisionFindFirstMock.mockResolvedValue(null) // foreign division

    await expect(
      attachUserToDivision("div-foreign", "user-1"),
    ).rejects.toThrow(/Division not found/)

    expect(txMemberFindFirstMock).not.toHaveBeenCalled()
    expect(txDivisionMemberUpsertMock).not.toHaveBeenCalled()
  })

  it("IDOR: rejects a non-member user id (guard 2 miss) — no upsert", async () => {
    txDivisionFindFirstMock.mockResolvedValue({ id: "div-1" }) // division owned
    txMemberFindFirstMock.mockResolvedValue(null) // user NOT in caller's org

    await expect(
      attachUserToDivision("div-1", "user-foreign"),
    ).rejects.toThrow(/not a member of your organization/)

    expect(txDivisionMemberUpsertMock).not.toHaveBeenCalled()
  })
})

describe("detachUserFromDivision", () => {
  it("blocks the detach when requireCan throws (non-Super)", async () => {
    requireCanMock.mockRejectedValue(new Error("Forbidden"))

    await expect(
      detachUserFromDivision("div-1", "user-1"),
    ).rejects.toThrow()

    expect(transactionMock).not.toHaveBeenCalled()
    expect(txDivisionMemberDeleteManyMock).not.toHaveBeenCalled()
  })

  it("happy path: deletes the membership row after the division guard passes", async () => {
    txDivisionFindFirstMock.mockResolvedValue({ id: "div-1" }) // division owned
    txDivisionMemberDeleteManyMock.mockResolvedValue({ count: 1 })

    await detachUserFromDivision("div-1", "user-1")

    expect(txDivisionFindFirstMock.mock.calls[0][0].where).toEqual({
      id: "div-1",
      vendorId: "vendor-caller",
    })
    expect(txDivisionMemberDeleteManyMock.mock.calls[0][0].where).toEqual({
      divisionId: "div-1",
      userId: "user-1",
    })
  })

  it("IDOR: rejects a cross-tenant division id (guard miss) — no delete", async () => {
    txDivisionFindFirstMock.mockResolvedValue(null) // foreign division

    await expect(
      detachUserFromDivision("div-foreign", "user-1"),
    ).rejects.toThrow(/Division not found/)

    expect(txDivisionMemberDeleteManyMock).not.toHaveBeenCalled()
  })
})
