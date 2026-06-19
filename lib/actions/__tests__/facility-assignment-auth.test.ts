/**
 * Auth + IDOR scoping suite for `lib/actions/facility-assignment.ts`.
 *
 * Tenant isolation is the #1 invariant (multi-tenant PHI + financial). This
 * file covers the SERVER-ACTION behavior of the per-user facility-assignment
 * matrix — the pure `contractsOwnedByFacilities` where-clause shape is already
 * locked by `facility-assignment-scope.test.ts` and is NOT duplicated here.
 *
 * Surfaces under test (exact exports):
 *   - getCallerFacilityIds       — enterprise (super) → HealthSystem universe;
 *                                  scoped → assignments ∪ home facility.
 *   - assignFacilityToUser        — Super-gated; IDOR guard 1 (facility in HS
 *                                   universe) + guard 2 (user in caller org).
 *   - unassignFacilityFromUser    — same gates, deleteMany.
 *   - getFacilityAssignments      — facility-scoped matrix bounded to the
 *                                   caller's HS facility universe + org members.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  facilityFindManyMock,
  facilityAssignmentFindManyMock,
  facilityAssignmentUpsertMock,
  facilityAssignmentDeleteManyMock,
  memberFindManyMock,
  memberFindFirstMock,
  transactionMock,
  requireFacilityMock,
  requireCanMock,
  getCurrentAccessContextMock,
} = vi.hoisted(() => ({
  facilityFindManyMock: vi.fn(),
  facilityAssignmentFindManyMock: vi.fn(),
  facilityAssignmentUpsertMock: vi.fn(),
  facilityAssignmentDeleteManyMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  requireFacilityMock: vi.fn(),
  requireCanMock: vi.fn(),
  getCurrentAccessContextMock: vi.fn(),
}))

// The transaction `tx` exposes exactly the models the source touches inside
// `$transaction`: member.findFirst + facilityAssignment.upsert/deleteMany.
const tx = {
  member: { findFirst: memberFindFirstMock },
  facilityAssignment: {
    upsert: facilityAssignmentUpsertMock,
    deleteMany: facilityAssignmentDeleteManyMock,
  },
}

vi.mock("@/lib/db", () => ({
  prisma: {
    facility: { findMany: facilityFindManyMock },
    facilityAssignment: {
      findMany: facilityAssignmentFindManyMock,
      upsert: facilityAssignmentUpsertMock,
      deleteMany: facilityAssignmentDeleteManyMock,
    },
    member: {
      findMany: memberFindManyMock,
      findFirst: memberFindFirstMock,
    },
    $transaction: transactionMock,
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: requireFacilityMock,
}))

vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCan: requireCanMock,
  getCurrentAccessContext: getCurrentAccessContextMock,
}))

// `serialize` is identity for plain objects — keep it transparent so we can
// assert on the returned shape directly.
vi.mock("@/lib/serialize", () => ({
  serialize: <T>(obj: T): T => obj,
}))

import {
  getFacilityAssignments,
  getCallerFacilityIds,
  assignFacilityToUser,
  unassignFacilityFromUser,
} from "@/lib/actions/facility-assignment"

// ─── Fixtures ────────────────────────────────────────────────────

interface SessionFacility {
  id: string
  name?: string
  healthSystemId: string | null
  organizationId: string | null
}

function mockSession(
  facility: SessionFacility,
  userId = "u-caller",
): void {
  requireFacilityMock.mockResolvedValue({
    user: { id: userId },
    facility,
  })
}

// HealthSystem "hs-1" universe = {fac-home, fac-sibling}; caller home = fac-home.
const HS_FACILITY: SessionFacility = {
  id: "fac-home",
  name: "Lighthouse Surgical Center",
  healthSystemId: "hs-1",
  organizationId: "org-1",
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: transaction runs the callback with the mocked tx (real path).
  transactionMock.mockImplementation(
    (cb: (t: typeof tx) => Promise<unknown>) => cb(tx),
  )
  // Default HS universe for facility.findMany (used by enterpriseFacilityIds).
  facilityFindManyMock.mockResolvedValue([
    { id: "fac-home" },
    { id: "fac-sibling" },
  ])
})

// ─── getCallerFacilityIds ────────────────────────────────────────

describe("getCallerFacilityIds — accessible-facility resolution", () => {
  it("enterprise (super) caller → ALL facilities in the caller's HealthSystem", async () => {
    mockSession(HS_FACILITY)
    getCurrentAccessContextMock.mockResolvedValue({ tier: "super", side: "facility" })
    facilityFindManyMock.mockResolvedValue([
      { id: "fac-home" },
      { id: "fac-sibling" },
      { id: "fac-third" },
    ])

    const ids = await getCallerFacilityIds()

    expect(facilityFindManyMock).toHaveBeenCalledWith({
      where: { healthSystemId: "hs-1" },
      select: { id: true },
    })
    expect([...ids].sort()).toEqual(["fac-home", "fac-sibling", "fac-third"])
    // Enterprise tier never falls back to the per-user assignment set.
    expect(facilityAssignmentFindManyMock).not.toHaveBeenCalled()
  })

  it("enterprise caller with NO healthSystemId → only their home facility (bounded, not global)", async () => {
    mockSession({ ...HS_FACILITY, healthSystemId: null })
    getCurrentAccessContextMock.mockResolvedValue({ tier: "super", side: "facility" })

    const ids = await getCallerFacilityIds()

    expect(ids).toEqual(["fac-home"])
    // No HealthSystem ⇒ never a `findMany` over every facility globally.
    expect(facilityFindManyMock).not.toHaveBeenCalled()
  })

  it("scoped caller → their FacilityAssignment set UNIONED with their home facility", async () => {
    mockSession(HS_FACILITY)
    getCurrentAccessContextMock.mockResolvedValue({ tier: "user", side: "facility" })
    facilityAssignmentFindManyMock.mockResolvedValue([
      { facilityId: "fac-assigned-a" },
      { facilityId: "fac-assigned-b" },
    ])

    const ids = await getCallerFacilityIds()

    expect(facilityAssignmentFindManyMock).toHaveBeenCalledWith({
      where: { userId: "u-caller" },
      select: { facilityId: true },
    })
    // Home facility is always present — a scoped user can't be locked out.
    expect([...ids].sort()).toEqual(["fac-assigned-a", "fac-assigned-b", "fac-home"])
    // Scoped path never enumerates the whole HealthSystem.
    expect(facilityFindManyMock).not.toHaveBeenCalled()
  })

  it("scoped caller with ZERO assignments → still includes home facility (never empty)", async () => {
    mockSession(HS_FACILITY)
    getCurrentAccessContextMock.mockResolvedValue({ tier: "user", side: "facility" })
    facilityAssignmentFindManyMock.mockResolvedValue([])

    const ids = await getCallerFacilityIds()

    expect(ids).toEqual(["fac-home"])
  })

  it("scoped caller — assignment already containing home facility is de-duped", async () => {
    mockSession(HS_FACILITY)
    getCurrentAccessContextMock.mockResolvedValue({ tier: "user", side: "facility" })
    facilityAssignmentFindManyMock.mockResolvedValue([
      { facilityId: "fac-home" },
      { facilityId: "fac-extra" },
    ])

    const ids = await getCallerFacilityIds()

    expect([...ids].sort()).toEqual(["fac-extra", "fac-home"])
    expect(ids.filter((id) => id === "fac-home")).toHaveLength(1)
  })

  it("null access context (treated as non-super) → scoped path", async () => {
    mockSession(HS_FACILITY)
    getCurrentAccessContextMock.mockResolvedValue(null)
    facilityAssignmentFindManyMock.mockResolvedValue([{ facilityId: "fac-x" }])

    const ids = await getCallerFacilityIds()

    expect([...ids].sort()).toEqual(["fac-home", "fac-x"])
    expect(facilityAssignmentFindManyMock).toHaveBeenCalledOnce()
  })

  it("propagates the auth gate failure when requireFacility throws", async () => {
    requireFacilityMock.mockRejectedValue(new Error("not a facility user"))

    await expect(getCallerFacilityIds()).rejects.toThrow(/not a facility user/i)
    expect(facilityAssignmentFindManyMock).not.toHaveBeenCalled()
  })
})

// ─── assignFacilityToUser ────────────────────────────────────────

describe("assignFacilityToUser — Super gate + IDOR guards", () => {
  it("non-Super caller (requireCan throws) → throws and writes NOTHING", async () => {
    requireCanMock.mockRejectedValue(new Error("Access denied: members.manage"))

    await expect(
      assignFacilityToUser("u-target", "fac-sibling"),
    ).rejects.toThrow(/access denied/i)

    expect(requireCanMock).toHaveBeenCalledWith("members.manage")
    // Gate runs before requireFacility / any DB work.
    expect(requireFacilityMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
    expect(facilityAssignmentUpsertMock).not.toHaveBeenCalled()
  })

  it("IDOR guard 1: target facility OUTSIDE the caller's HealthSystem → throws, no upsert", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)
    // universe = {fac-home, fac-sibling}; target fac-foreign is outside it.

    await expect(
      assignFacilityToUser("u-target", "fac-foreign"),
    ).rejects.toThrow(/not within your health system/i)

    expect(memberFindFirstMock).not.toHaveBeenCalled()
    expect(facilityAssignmentUpsertMock).not.toHaveBeenCalled()
  })

  it("IDOR guard 2: target user NOT a member of the caller's org → throws, no upsert", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)
    memberFindFirstMock.mockResolvedValue(null) // foreign user

    await expect(
      assignFacilityToUser("u-foreign", "fac-sibling"),
    ).rejects.toThrow(/not a member of your organization/i)

    expect(memberFindFirstMock).toHaveBeenCalledWith({
      where: { userId: "u-foreign", organizationId: "org-1" },
      select: { id: true },
    })
    expect(facilityAssignmentUpsertMock).not.toHaveBeenCalled()
  })

  it("throws when the caller facility has no organization (no upsert)", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession({ ...HS_FACILITY, organizationId: null })

    await expect(
      assignFacilityToUser("u-target", "fac-sibling"),
    ).rejects.toThrow(/no organization/i)

    expect(facilityAssignmentUpsertMock).not.toHaveBeenCalled()
  })

  it("happy path: both guards pass → upserts the assignment (scoped where)", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)
    memberFindFirstMock.mockResolvedValue({ id: "member-1" })
    facilityAssignmentUpsertMock.mockResolvedValue({})

    await assignFacilityToUser("u-target", "fac-sibling")

    expect(transactionMock).toHaveBeenCalledOnce()
    expect(facilityAssignmentUpsertMock).toHaveBeenCalledWith({
      where: { userId_facilityId: { userId: "u-target", facilityId: "fac-sibling" } },
      create: { userId: "u-target", facilityId: "fac-sibling" },
      update: {},
    })
    expect(facilityAssignmentDeleteManyMock).not.toHaveBeenCalled()
  })

  it("rejects an empty userId / facilityId before any write (zod gate)", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)

    await expect(assignFacilityToUser("", "fac-sibling")).rejects.toThrow()
    expect(transactionMock).not.toHaveBeenCalled()
    expect(facilityAssignmentUpsertMock).not.toHaveBeenCalled()
  })
})

// ─── unassignFacilityFromUser ────────────────────────────────────

describe("unassignFacilityFromUser — Super gate + IDOR guards", () => {
  it("non-Super caller → throws and deletes NOTHING", async () => {
    requireCanMock.mockRejectedValue(new Error("Access denied: members.manage"))

    await expect(
      unassignFacilityFromUser("u-target", "fac-sibling"),
    ).rejects.toThrow(/access denied/i)

    expect(transactionMock).not.toHaveBeenCalled()
    expect(facilityAssignmentDeleteManyMock).not.toHaveBeenCalled()
  })

  it("IDOR guard 1: target facility outside HealthSystem → throws, no delete", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)

    await expect(
      unassignFacilityFromUser("u-target", "fac-foreign"),
    ).rejects.toThrow(/not within your health system/i)

    expect(memberFindFirstMock).not.toHaveBeenCalled()
    expect(facilityAssignmentDeleteManyMock).not.toHaveBeenCalled()
  })

  it("IDOR guard 2: target user not in caller org → throws, no delete", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)
    memberFindFirstMock.mockResolvedValue(null)

    await expect(
      unassignFacilityFromUser("u-foreign", "fac-sibling"),
    ).rejects.toThrow(/not a member of your organization/i)

    expect(facilityAssignmentDeleteManyMock).not.toHaveBeenCalled()
  })

  it("happy path: both guards pass → deletes the assignment (scoped where)", async () => {
    requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
    mockSession(HS_FACILITY)
    memberFindFirstMock.mockResolvedValue({ id: "member-1" })
    facilityAssignmentDeleteManyMock.mockResolvedValue({ count: 1 })

    await unassignFacilityFromUser("u-target", "fac-sibling")

    expect(facilityAssignmentDeleteManyMock).toHaveBeenCalledWith({
      where: { userId: "u-target", facilityId: "fac-sibling" },
    })
    expect(facilityAssignmentUpsertMock).not.toHaveBeenCalled()
  })
})

// ─── getFacilityAssignments ──────────────────────────────────────

describe("getFacilityAssignments — scoped matrix (no cross-tenant leak)", () => {
  it("bounds the facility universe + member-assignment query to the caller's HealthSystem", async () => {
    mockSession(HS_FACILITY)
    facilityFindManyMock
      // 1st call: enterpriseFacilityIds (universe ids)
      .mockResolvedValueOnce([{ id: "fac-home" }, { id: "fac-sibling" }])
      // 2nd call: the facilities-with-names selection
      .mockResolvedValueOnce([
        { id: "fac-home", name: "Lighthouse Surgical Center" },
        { id: "fac-sibling", name: "Lighthouse Community Hospital" },
      ])
    memberFindManyMock.mockResolvedValue([
      {
        user: {
          id: "u-1",
          name: "Alice",
          email: "alice@lighthouse.com",
          facilityAssignments: [{ facilityId: "fac-sibling" }],
        },
      },
    ])

    const result = await getFacilityAssignments()

    // The named-facility list is scoped to the HS universe, not all facilities.
    expect(facilityFindManyMock).toHaveBeenLastCalledWith({
      where: { id: { in: ["fac-home", "fac-sibling"] } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })

    // Members are scoped to the caller's org, and each user's assignments are
    // bounded to the HS universe (cross-tenant rows can't leak in).
    const memberCall = memberFindManyMock.mock.calls[0][0] as {
      where: { organizationId: string }
      select: {
        user: {
          select: {
            facilityAssignments: { where: { facilityId: { in: string[] } } }
          }
        }
      }
    }
    expect(memberCall.where).toEqual({ organizationId: "org-1" })
    expect(
      memberCall.select.user.select.facilityAssignments.where,
    ).toEqual({ facilityId: { in: ["fac-home", "fac-sibling"] } })

    expect(result.facilities).toEqual([
      { id: "fac-home", name: "Lighthouse Surgical Center" },
      { id: "fac-sibling", name: "Lighthouse Community Hospital" },
    ])
    expect(result.users).toEqual([
      {
        userId: "u-1",
        name: "Alice",
        email: "alice@lighthouse.com",
        assignedFacilityIds: ["fac-sibling"],
      },
    ])
  })

  it("returns NO members when the caller facility has no organization", async () => {
    mockSession({ ...HS_FACILITY, organizationId: null })
    facilityFindManyMock
      .mockResolvedValueOnce([{ id: "fac-home" }])
      .mockResolvedValueOnce([{ id: "fac-home", name: "Lighthouse Surgical Center" }])

    const result = await getFacilityAssignments()

    // org-less caller never queries members.
    expect(memberFindManyMock).not.toHaveBeenCalled()
    expect(result.users).toEqual([])
    expect(result.facilities).toEqual([
      { id: "fac-home", name: "Lighthouse Surgical Center" },
    ])
  })

  it("de-dupes a user appearing across multiple Member rows", async () => {
    mockSession(HS_FACILITY)
    facilityFindManyMock
      .mockResolvedValueOnce([{ id: "fac-home" }])
      .mockResolvedValueOnce([{ id: "fac-home", name: "Lighthouse Surgical Center" }])
    const userPayload = {
      id: "u-dup",
      name: "Bob",
      email: "bob@lighthouse.com",
      facilityAssignments: [{ facilityId: "fac-home" }],
    }
    memberFindManyMock.mockResolvedValue([
      { user: userPayload },
      { user: userPayload }, // same user, second org row
    ])

    const result = await getFacilityAssignments()

    expect(result.users).toHaveLength(1)
    expect(result.users[0].userId).toBe("u-dup")
  })

  it("propagates the auth gate failure when requireFacility throws", async () => {
    requireFacilityMock.mockRejectedValue(new Error("redirect to /login"))

    await expect(getFacilityAssignments()).rejects.toThrow(/redirect/i)
    expect(facilityFindManyMock).not.toHaveBeenCalled()
    expect(memberFindManyMock).not.toHaveBeenCalled()
  })
})
