/**
 * Charles audit Iter4-B1 / Iter4-B2 regression suite (BLOCKER).
 *
 *  - Iter4-B1 — `getConnections` previously built its where clause
 *    directly from input under requireAuth() only, so passing `{}`
 *    returned every Connection on the platform and passing a foreign
 *    tenant's id returned that tenant's connections. The fix derives
 *    scope from the session and ignores facilityId/vendorId from
 *    input.
 *
 *  - Iter4-B2 — `sendConnectionInvite` previously took spoofable
 *    `fromType` / `fromId` / `fromName` from input, letting one
 *    tenant mint a Connection row that appeared to originate from
 *    another. The fix derives those three from the session and
 *    ignores the input variants.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  connectionFindManyMock,
  connectionCreateMock,
  memberFindFirstMock,
  vendorFindFirstMock,
  facilityFindFirstMock,
  requireAuthMock,
} = vi.hoisted(() => ({
  connectionFindManyMock: vi.fn().mockResolvedValue([]),
  connectionCreateMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  vendorFindFirstMock: vi.fn(),
  facilityFindFirstMock: vi.fn(),
  requireAuthMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: {
      findMany: connectionFindManyMock,
      create: connectionCreateMock,
    },
    member: { findFirst: memberFindFirstMock },
    vendor: { findFirst: vendorFindFirstMock },
    facility: { findFirst: facilityFindFirstMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireAuth: requireAuthMock,
}))

import { getConnections, sendConnectionInvite } from "@/lib/actions/connections"

beforeEach(() => {
  vi.clearAllMocks()
  connectionFindManyMock.mockResolvedValue([])
})

describe("getConnections — Iter4-B1", () => {
  it("scopes to the caller's facility regardless of input.facilityId/vendorId", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "f@example.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: {
        facility: { id: "fac-caller", name: "Lighthouse" },
        vendor: null,
      },
    })

    // Attacker passes an empty input *and* a foreign vendorId — both
    // must be ignored.
    await getConnections({
      facilityId: "fac-victim",
      vendorId: "vendor-victim",
    })

    expect(connectionFindManyMock).toHaveBeenCalledOnce()
    const where = connectionFindManyMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({ facilityId: "fac-caller" })
  })

  it("scopes to the caller's vendor when caller is a vendor user", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-2", email: "v@example.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: {
        facility: null,
        vendor: { id: "vendor-caller", name: "Medtronic" },
      },
    })

    await getConnections({ facilityId: "fac-anything" })

    const where = connectionFindManyMock.mock.calls[0][0].where as Record<
      string,
      unknown
    >
    expect(where).toEqual({ vendorId: "vendor-caller" })
  })

  it("rejects when the caller is not a member of any facility or vendor org", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-3", email: "x@example.com" },
    })
    memberFindFirstMock.mockResolvedValue(null)

    await expect(getConnections({})).rejects.toThrow(/not authorized/i)
    expect(connectionFindManyMock).not.toHaveBeenCalled()
  })
})

describe("sendConnectionInvite — Iter4-B2", () => {
  it("derives fromId/fromName/fromType from the session, ignoring input", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-1", email: "real@lighthouse.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: {
        facility: { id: "fac-real", name: "Lighthouse Surgical Center" },
        vendor: null,
      },
    })
    vendorFindFirstMock.mockResolvedValue({
      id: "vendor-target",
      name: "Medtronic",
    })
    connectionCreateMock.mockResolvedValue({
      id: "conn-1",
      facilityId: "fac-real",
      facilityName: "Lighthouse Surgical Center",
      vendorId: "vendor-target",
      vendorName: "Medtronic",
      status: "pending",
      inviteType: "facility_to_vendor",
      invitedByEmail: "real@lighthouse.com",
      invitedAt: new Date(),
      respondedAt: null,
      message: null,
    })

    await sendConnectionInvite({
      // Attacker tries to spoof Medtronic-as-Lighthouse: pre-fix the
      // server trusted these fields verbatim and the row was created
      // with `facilityId: "fac-spoofed"`. Post-fix they are ignored.
      fromType: "vendor",
      fromId: "fac-spoofed",
      fromName: "Spoofed Inc",
      toEmail: "vendor@medtronic.com",
      toName: "Medtronic",
    })

    expect(connectionCreateMock).toHaveBeenCalledOnce()
    const data = connectionCreateMock.mock.calls[0][0].data as Record<
      string,
      unknown
    >
    // The invite came from the SESSION's facility, not from input.
    expect(data.facilityId).toBe("fac-real")
    expect(data.facilityName).toBe("Lighthouse Surgical Center")
    expect(data.inviteType).toBe("facility_to_vendor")
    expect(data.invitedBy).toBe("u-1")
  })

  it("rejects when the caller has no facility or vendor org membership", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-orphan", email: "x@example.com" },
    })
    memberFindFirstMock.mockResolvedValue(null)

    await expect(
      sendConnectionInvite({
        toEmail: "v@example.com",
        toName: "X",
      }),
    ).rejects.toThrow(/not authorized/i)
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })
})
