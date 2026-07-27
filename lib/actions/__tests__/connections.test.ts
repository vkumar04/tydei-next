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
  connectionFindFirstMock,
  connectionUpdateManyMock,
  memberFindFirstMock,
  vendorFindFirstMock,
  facilityFindFirstMock,
  requireAuthMock,
} = vi.hoisted(() => ({
  connectionFindManyMock: vi.fn().mockResolvedValue([]),
  connectionCreateMock: vi.fn(),
  connectionFindFirstMock: vi.fn(),
  connectionUpdateManyMock: vi.fn(),
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
      findFirst: connectionFindFirstMock,
      updateMany: connectionUpdateManyMock,
    },
    member: { findFirst: memberFindFirstMock },
    vendor: { findFirst: vendorFindFirstMock },
    facility: { findFirst: facilityFindFirstMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireAuth: requireAuthMock,
}))

import {
  getConnections,
  sendConnectionInvite,
  acceptConnection,
} from "@/lib/actions/connections"

beforeEach(() => {
  vi.clearAllMocks()
  connectionFindManyMock.mockResolvedValue([])
  connectionUpdateManyMock.mockResolvedValue({ count: 1 })
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

  it("returns [] (no leak) when the caller is not a member of any facility or vendor org", async () => {
    // BUG 3 (Charles 2026-06-20): a no-identity caller (e.g. a platform admin
    // on a tenant settings surface) must NOT throw — that surfaced as the
    // "Server Components render" digest toast. Returning [] keeps the
    // tenant-scoping property (no rows leak) without the crash.
    requireAuthMock.mockResolvedValue({
      user: { id: "u-3", email: "x@example.com" },
    })
    memberFindFirstMock.mockResolvedValue(null)

    await expect(getConnections({})).resolves.toEqual([])
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

/**
 * Charles 2026-07-27 — accepting is RECIPIENT-only.
 *
 * This became load-bearing when one-way vendor contracts started
 * auto-activating: `canAutoActivate` (lib/connections/operating-mode.ts)
 * treats an ACCEPTED one_way Connection as permission for the vendor to write
 * a LIVE contract into that facility's tenant. `sendConnectionInvite` lets any
 * vendor mint a `pending` row against a facility matched by NAME off the wire,
 * so if the inviter could also accept, a vendor manufactured facility consent
 * in two calls — a cross-tenant write with nobody at the facility involved.
 */
describe("acceptConnection — recipient-only", () => {
  it("refuses to let the INVITER accept its own invite (the self-accept bypass)", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-v", email: "rep@stryker.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: "vendor-caller" } },
    })
    // The vendor's own outbound invite at a facility it has no relationship
    // with — the row it just created via sendConnectionInvite.
    connectionFindFirstMock.mockResolvedValue({
      facilityId: "fac-victim",
      vendorId: "vendor-caller",
      inviteType: "vendor_to_facility",
    })

    await expect(acceptConnection("conn-1")).rejects.toThrow(
      /only the invited party/i,
    )
    expect(connectionUpdateManyMock).not.toHaveBeenCalled()
  })

  it("refuses a caller who is not a party to the connection at all", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-x", email: "rep@other.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null, vendor: { id: "vendor-stranger" } },
    })
    // The tenant-scoped read finds nothing for a stranger.
    connectionFindFirstMock.mockResolvedValue(null)

    await expect(acceptConnection("conn-1")).rejects.toThrow(/not authorized/i)
    expect(connectionUpdateManyMock).not.toHaveBeenCalled()
  })

  it("lets the invited facility accept, and scopes + compare-and-swaps the write", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-f", email: "ops@lighthouse.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: { id: "fac-victim" }, vendor: null },
    })
    connectionFindFirstMock.mockResolvedValue({
      facilityId: "fac-victim",
      vendorId: "vendor-caller",
      inviteType: "vendor_to_facility",
    })

    await acceptConnection("conn-1")

    // The read is narrowed to the caller's own tenant before any decision.
    expect(connectionFindFirstMock.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      facilityId: "fac-victim",
    })
    // Both party ids carry into the write, and only a PENDING row may flip —
    // otherwise accept would re-open a rejected/expired invite.
    expect(connectionUpdateManyMock.mock.calls[0][0].where).toEqual({
      id: "conn-1",
      facilityId: "fac-victim",
      vendorId: "vendor-caller",
      status: "pending",
    })
  })

  it("throws instead of silently no-op'ing when the row is no longer pending", async () => {
    requireAuthMock.mockResolvedValue({
      user: { id: "u-f", email: "ops@lighthouse.com" },
    })
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: { id: "fac-victim" }, vendor: null },
    })
    connectionFindFirstMock.mockResolvedValue({
      facilityId: "fac-victim",
      vendorId: "vendor-caller",
      inviteType: "vendor_to_facility",
    })
    connectionUpdateManyMock.mockResolvedValue({ count: 0 })

    await expect(acceptConnection("conn-1")).rejects.toThrow(
      /no longer pending/i,
    )
  })
})
