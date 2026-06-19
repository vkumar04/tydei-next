import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Coverage for the vendor connection-mode gate + IDOR scoping
 * (`lib/actions/connection-mode.ts`).
 *
 *  - `vendorContractsVisibleToFacility` is the contract-flow GATE: only
 *    `status: "accepted"` AND `mode: "two_way"` connections may surface a
 *    vendor's contracts to a facility. We assert the `where` carries both,
 *    that vendorIds dedupe, and that null divisions drop.
 *  - `getConnectionMode` / `setConnectionMode` are vendor-scoped (no IDOR):
 *    every read/write is bound to the caller's own `vendor.id`, and the
 *    mutation is additionally gated by `requireCanMutate` (read-only users
 *    are blocked).
 */

const { connectionFindManyMock, connectionFindFirstMock, connectionUpdateManyMock } =
  vi.hoisted(() => ({
    connectionFindManyMock: vi.fn(),
    connectionFindFirstMock: vi.fn(),
    connectionUpdateManyMock: vi.fn(),
  }))

const { requireVendorMock } = vi.hoisted(() => ({
  requireVendorMock: vi.fn(),
}))

const { requireCanMutateMock } = vi.hoisted(() => ({
  requireCanMutateMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findMany: connectionFindManyMock,
      findFirst: connectionFindFirstMock,
      updateMany: connectionUpdateManyMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
}))

vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: requireCanMutateMock,
}))

import {
  vendorContractsVisibleToFacility,
  getConnectionMode,
  setConnectionMode,
} from "@/lib/actions/connection-mode"

beforeEach(() => {
  vi.clearAllMocks()
})

type FindManyWhere = { facilityId: string; status: string; mode: string }

function whereOf(): FindManyWhere {
  return connectionFindManyMock.mock.calls[0][0].where as FindManyWhere
}

describe("vendorContractsVisibleToFacility — the contract-flow gate", () => {
  it("queries with status:accepted AND mode:two_way (the gate)", async () => {
    connectionFindManyMock.mockResolvedValue([])

    await vendorContractsVisibleToFacility("fac-1")

    expect(connectionFindManyMock).toHaveBeenCalledOnce()
    const where = whereOf()
    expect(where.facilityId).toBe("fac-1")
    expect(where.status).toBe("accepted")
    expect(where.mode).toBe("two_way")
  })

  it("returns the vendorIds/vendorDivisionIds from the (already-gated) rows", async () => {
    // The DB does the accepted+two_way filtering; this asserts the
    // mapping shape of whatever the gated query returns.
    connectionFindManyMock.mockResolvedValue([
      { vendorId: "v-1", vendorDivisionId: "d-1" },
      { vendorId: "v-2", vendorDivisionId: "d-2" },
    ])

    const result = await vendorContractsVisibleToFacility("fac-1")

    expect(result.vendorIds).toEqual(["v-1", "v-2"])
    expect(result.vendorDivisionIds).toEqual(["d-1", "d-2"])
  })

  it("dedupes repeated vendorIds", async () => {
    connectionFindManyMock.mockResolvedValue([
      { vendorId: "v-1", vendorDivisionId: "d-1" },
      { vendorId: "v-1", vendorDivisionId: "d-1" },
      { vendorId: "v-2", vendorDivisionId: null },
    ])

    const result = await vendorContractsVisibleToFacility("fac-1")

    expect(result.vendorIds).toEqual(["v-1", "v-2"])
  })

  it("drops null vendorDivisionIds and dedupes the rest", async () => {
    connectionFindManyMock.mockResolvedValue([
      { vendorId: "v-1", vendorDivisionId: null },
      { vendorId: "v-2", vendorDivisionId: "d-1" },
      { vendorId: "v-3", vendorDivisionId: "d-1" },
      { vendorId: "v-4", vendorDivisionId: null },
    ])

    const result = await vendorContractsVisibleToFacility("fac-1")

    expect(result.vendorDivisionIds).toEqual(["d-1"])
  })

  it("returns empty arrays when no accepted+two_way connection exists", async () => {
    connectionFindManyMock.mockResolvedValue([])

    const result = await vendorContractsVisibleToFacility("fac-1")

    expect(result).toEqual({ vendorIds: [], vendorDivisionIds: [] })
  })
})

describe("getConnectionMode — vendor-scoped read (IDOR)", () => {
  it("scopes the findFirst to the caller's own vendorId and returns mode", async () => {
    requireVendorMock.mockResolvedValue({ vendor: { id: "vendor-caller" } })
    connectionFindFirstMock.mockResolvedValue({ mode: "two_way" })

    const mode = await getConnectionMode("conn-1")

    expect(mode).toBe("two_way")
    expect(connectionFindFirstMock).toHaveBeenCalledOnce()
    const where = connectionFindFirstMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({ id: "conn-1", vendorId: "vendor-caller" })
  })

  it("throws 'Connection not found' when the connection is not owned by the caller's vendor", async () => {
    requireVendorMock.mockResolvedValue({ vendor: { id: "vendor-caller" } })
    // Foreign connection id → scoped findFirst returns null.
    connectionFindFirstMock.mockResolvedValue(null)

    await expect(getConnectionMode("conn-foreign")).rejects.toThrow(
      /Connection not found/,
    )
  })
})

describe("setConnectionMode — vendor-scoped write, gated (IDOR + read-only)", () => {
  it("blocks the write when requireCanMutate throws (read-only user)", async () => {
    requireCanMutateMock.mockRejectedValue(new Error("read-only"))
    requireVendorMock.mockResolvedValue({ vendor: { id: "vendor-caller" } })

    await expect(setConnectionMode("conn-1", "two_way")).rejects.toThrow()

    expect(connectionUpdateManyMock).not.toHaveBeenCalled()
  })

  it("scopes the updateMany to the caller's vendorId (NOT a bare { id })", async () => {
    requireCanMutateMock.mockResolvedValue(undefined)
    requireVendorMock.mockResolvedValue({ vendor: { id: "vendor-caller" } })
    connectionUpdateManyMock.mockResolvedValue({ count: 1 })

    await setConnectionMode("conn-1", "one_way")

    expect(connectionUpdateManyMock).toHaveBeenCalledOnce()
    const where = connectionUpdateManyMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({ id: "conn-1", vendorId: "vendor-caller" })
    // It is NOT a bare { id }.
    expect(Object.keys(where)).toContain("vendorId")
  })

  it("throws 'Connection not found' when count === 0 (foreign id, not owned)", async () => {
    requireCanMutateMock.mockResolvedValue(undefined)
    requireVendorMock.mockResolvedValue({ vendor: { id: "vendor-caller" } })
    connectionUpdateManyMock.mockResolvedValue({ count: 0 })

    await expect(
      setConnectionMode("conn-foreign", "two_way"),
    ).rejects.toThrow(/Connection not found/)
  })

  it("returns { id, mode } on a successful scoped update", async () => {
    requireCanMutateMock.mockResolvedValue(undefined)
    requireVendorMock.mockResolvedValue({ vendor: { id: "vendor-caller" } })
    connectionUpdateManyMock.mockResolvedValue({ count: 1 })

    const result = await setConnectionMode("conn-1", "two_way")

    expect(result).toEqual({ id: "conn-1", mode: "two_way" })
    expect(connectionUpdateManyMock.mock.calls[0][0].data).toEqual({
      mode: "two_way",
    })
  })
})
