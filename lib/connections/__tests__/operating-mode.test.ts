/**
 * Charles 2026-07-27 ("if it is set up for 1 way on a facility it does not
 * need to submit a contract it just becomes active after creating it").
 *
 * `canAutoActivate` is the gate that decides whether a vendor-created
 * submission skips facility review and lands as a LIVE Contract — i.e. whether
 * `createPendingContract` writes into a facility's tenant without that facility
 * ever seeing it. It is pure, so it is tested directly rather than through the
 * action: the failure mode we care about is a boolean, and the boolean is the
 * whole tenant boundary.
 *
 * The cross-tenant case is the one that matters most (`one_way` + a facility
 * the vendor has no accepted Connection with ⇒ FALSE). Two vendor-callable
 * actions make that reachable if the gate slips:
 *   - the "New Contract" facility picker (now scoped, but the payload's
 *     facilityId is still client-supplied), and
 *   - `sendConnectionInvite`, which lets a vendor mint a `pending` / `one_way`
 *     Connection row against any facility it can name.
 * Hence "accepted", not "a row exists".
 *
 * `resolveOperatingMode` touches prisma, so `@/lib/db` is mocked even for the
 * pure assertions (the module imports it at load).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { connectionFindFirst, vendorFindUnique } = vi.hoisted(() => ({
  connectionFindFirst: vi.fn(),
  vendorFindUnique: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    connection: { findFirst: connectionFindFirst },
    vendor: { findUnique: vendorFindUnique },
  },
}))

import {
  canAutoActivate,
  resolveOperatingMode,
  type ResolvedOperatingMode,
} from "@/lib/connections/operating-mode"

/** Build a resolved mode without restating the whole shape at each call. */
function resolved(
  over: Partial<ResolvedOperatingMode> = {},
): ResolvedOperatingMode {
  return {
    mode: "one_way",
    source: "derived",
    hasConnectionForFacility: false,
    connectionStatus: null,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  connectionFindFirst.mockResolvedValue(null)
  vendorFindUnique.mockResolvedValue(null)
})

describe("canAutoActivate — one_way", () => {
  it("no facility named → true (standalone vendor's OWN contract)", () => {
    expect(canAutoActivate(resolved(), null)).toBe(true)
    expect(canAutoActivate(resolved(), undefined)).toBe(true)
    // Empty string is the client's "nothing selected" — must not be treated
    // as a named facility.
    expect(canAutoActivate(resolved(), "")).toBe(true)
  })

  it("facility WITH an accepted connection → true", () => {
    expect(
      canAutoActivate(
        resolved({
          source: "connection",
          hasConnectionForFacility: true,
          connectionStatus: "accepted",
        }),
        "fac-1",
      ),
    ).toBe(true)
  })

  it("facility WITHOUT any connection → false (the cross-tenant guard)", () => {
    // The dangerous shape: a vendor-global default says one_way, and the
    // payload names someone else's facility. Auto-activating here would mint
    // a live contract inside a tenant the vendor has no relationship with.
    expect(
      canAutoActivate(
        resolved({ source: "vendorDefault", hasConnectionForFacility: false }),
        "fac-victim",
      ),
    ).toBe(false)
    expect(
      canAutoActivate(
        resolved({ source: "derived", hasConnectionForFacility: false }),
        "fac-victim",
      ),
    ).toBe(false)
  })

  it("facility with a NON-accepted connection → false (self-invite is not consent)", () => {
    // `sendConnectionInvite` is vendor-callable and creates a `pending` /
    // `one_way` row against a facility matched by NAME off the wire. Existence
    // of a row must never be enough.
    for (const status of ["pending", "rejected", "expired"] as const) {
      expect(
        canAutoActivate(
          resolved({
            source: "connection",
            hasConnectionForFacility: true,
            connectionStatus: status,
          }),
          "fac-1",
        ),
      ).toBe(false)
    }
  })
})

describe("canAutoActivate — two_way", () => {
  it("is false in every case (a reviewer exists; the facility reviews)", () => {
    expect(canAutoActivate(resolved({ mode: "two_way" }), null)).toBe(false)
    expect(canAutoActivate(resolved({ mode: "two_way" }), undefined)).toBe(false)
    expect(
      canAutoActivate(
        resolved({
          mode: "two_way",
          source: "connection",
          hasConnectionForFacility: true,
          connectionStatus: "accepted",
        }),
        "fac-1",
      ),
    ).toBe(false)
    expect(
      canAutoActivate(
        resolved({ mode: "two_way", source: "vendorDefault" }),
        "fac-1",
      ),
    ).toBe(false)
  })
})

describe("resolveOperatingMode — precedence", () => {
  it("1. a Connection row for THIS pair wins, and reports its status", async () => {
    connectionFindFirst.mockResolvedValueOnce({
      mode: "one_way",
      status: "accepted",
    })
    vendorFindUnique.mockResolvedValueOnce({ defaultMode: "two_way" })

    const r = await resolveOperatingMode({
      vendorId: "v-1",
      facilityId: "fac-1",
    })

    expect(r).toEqual({
      mode: "one_way",
      source: "connection",
      hasConnectionForFacility: true,
      connectionStatus: "accepted",
    })
    // The pair lookup is vendor-scoped — a foreign facilityId can only ever
    // resolve to a row this vendor is a party to.
    expect(connectionFindFirst.mock.calls[0][0].where).toEqual({
      vendorId: "v-1",
      facilityId: "fac-1",
    })
    expect(canAutoActivate(r, "fac-1")).toBe(true)
  })

  it("2. Vendor.defaultMode when there is no pair row — never enough to auto-activate onto a named facility", async () => {
    connectionFindFirst.mockResolvedValueOnce(null) // pair lookup
    vendorFindUnique.mockResolvedValueOnce({ defaultMode: "one_way" })
    connectionFindFirst.mockResolvedValueOnce(null) // accepted two_way probe

    const r = await resolveOperatingMode({
      vendorId: "v-1",
      facilityId: "fac-victim",
    })

    expect(r.mode).toBe("one_way")
    expect(r.source).toBe("vendorDefault")
    expect(r.hasConnectionForFacility).toBe(false)
    expect(r.connectionStatus).toBeNull()
    expect(canAutoActivate(r, "fac-victim")).toBe(false)
    // …but the same vendor's own facility-less contract still auto-activates.
    expect(canAutoActivate(r, null)).toBe(true)
  })

  it("3. derived — any accepted two_way connection ⇒ two_way, else one_way", async () => {
    // No facilityId → no pair lookup at all, so the single connection.findFirst
    // call is the accepted-two_way probe.
    vendorFindUnique.mockResolvedValueOnce({ defaultMode: null })
    connectionFindFirst.mockResolvedValueOnce({ id: "conn-2way" })

    const twoWay = await resolveOperatingMode({ vendorId: "v-1" })
    expect(twoWay).toEqual({
      mode: "two_way",
      source: "derived",
      hasConnectionForFacility: false,
      connectionStatus: null,
    })
    expect(canAutoActivate(twoWay, null)).toBe(false)

    vi.clearAllMocks()
    connectionFindFirst.mockResolvedValue(null)
    vendorFindUnique.mockResolvedValue({ defaultMode: null })

    const oneWay = await resolveOperatingMode({ vendorId: "v-1" })
    expect(oneWay.mode).toBe("one_way")
    expect(oneWay.source).toBe("derived")
    expect(canAutoActivate(oneWay, null)).toBe(true)
  })

  it("skips the pair lookup entirely when no facility is named", async () => {
    vendorFindUnique.mockResolvedValueOnce({ defaultMode: "one_way" })
    connectionFindFirst.mockResolvedValueOnce(null) // accepted two_way probe only

    await resolveOperatingMode({ vendorId: "v-1", facilityId: null })

    // One call — the accepted-two_way probe, not a pair lookup.
    expect(connectionFindFirst).toHaveBeenCalledTimes(1)
    expect(connectionFindFirst.mock.calls[0][0].where).toEqual({
      vendorId: "v-1",
      status: "accepted",
      mode: "two_way",
    })
  })
})
