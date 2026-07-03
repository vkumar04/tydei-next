import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Coverage for the vendor connection-mode setter + IDOR scoping
 * (`lib/actions/connection-mode.ts`).
 *
 *  - `setConnectionMode` is vendor-scoped (no IDOR): the write is bound to
 *    the caller's own `vendor.id` and gated by `requireCanMutate` (read-only
 *    users are blocked).
 *
 * (The unused facility-side gate `vendorContractsVisibleToFacility` and the
 * unused `getConnectionMode` read were removed 2026-07-03 — Vick "remove
 * them if they're not being used". The ONE mode-gated read is now
 * `getFacilityActualsForVendor`, covered by
 * `facility-actuals-for-vendor.test.ts`.)
 */

const { connectionUpdateManyMock } = vi.hoisted(() => ({
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

import { setConnectionMode } from "@/lib/actions/connection-mode"

beforeEach(() => {
  vi.clearAllMocks()
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
