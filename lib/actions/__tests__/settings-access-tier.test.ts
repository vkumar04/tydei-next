import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Access-tier gating coverage for the NEW Settings/Users behavior in
 * `lib/actions/settings.ts`. This complements (and does NOT duplicate)
 * `settings.test.ts`, which already covers invite-role enums, last-admin,
 * owner-protection, and cross-org scope.
 *
 * What is NEW here:
 *   - `updateMemberAccessTier(memberId, tier)` — zod enum, the
 *     `requireCan("members.manage")` gate, org-scope (`assertCallerCanManage`),
 *     and owner-protection.
 *   - the `requireCan("settings.manage")` gate on settings writes
 *     (`updateFacilityProfile`, `updateFeatureFlags`).
 *   - the `requireCan("members.manage")` gate on member writes
 *     (`inviteTeamMember`).
 *
 * Mocking strategy: `@/lib/actions/auth-permissions` is mocked so each test
 * controls `requireCan`'s outcome (resolve for Super, throw an
 * AccessDeniedError-shaped error for Advanced/User). When the gate throws we
 * assert the DOWNSTREAM prisma / better-auth mocks were never called — so the
 * gate ORDER (before or after the org/owner checks) doesn't matter to the
 * assertion.
 */

const {
  memberFindFirstMock,
  memberFindManyMock,
  memberFindUniqueMock,
  memberFindUniqueOrThrowMock,
  memberUpdateMock,
  facilityUpdateMock,
  featureFlagUpsertMock,
  authGetSessionMock,
  authCreateInvitationMock,
  requireAuthMock,
  requireFacilityMock,
  requireVendorMock,
  requireCanMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindUniqueOrThrowMock: vi.fn(),
  memberUpdateMock: vi.fn(),
  facilityUpdateMock: vi.fn(),
  featureFlagUpsertMock: vi.fn(),
  authGetSessionMock: vi.fn(),
  authCreateInvitationMock: vi.fn(),
  requireAuthMock: vi.fn(),
  requireFacilityMock: vi.fn(),
  requireVendorMock: vi.fn(),
  requireCanMock: vi.fn(),
}))

// AccessDeniedError-shaped error so tests can throw exactly what the real
// `requireCan` throws.
class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccessDeniedError"
  }
}

vi.mock("@/lib/db", () => ({
  prisma: {
    member: {
      findFirst: memberFindFirstMock,
      findMany: memberFindManyMock,
      findUnique: memberFindUniqueMock,
      findUniqueOrThrow: memberFindUniqueOrThrowMock,
      update: memberUpdateMock,
    },
    facility: { update: facilityUpdateMock },
    featureFlag: { upsert: featureFlagUpsertMock },
  },
}))

vi.mock("@/lib/auth-server", () => ({
  auth: {
    api: {
      getSession: authGetSessionMock,
      createInvitation: authCreateInvitationMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: requireAuthMock,
  requireFacility: requireFacilityMock,
  requireVendor: requireVendorMock,
}))

vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCan: requireCanMock,
}))

vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import {
  updateMemberAccessTier,
  updateFacilityProfile,
  updateFeatureFlags,
  inviteTeamMember,
} from "@/lib/actions/settings"

beforeEach(() => {
  vi.clearAllMocks()
  // Default: caller IS authenticated; tests override as needed.
  requireAuthMock.mockResolvedValue({ user: { id: "u-super" } })
})

/** Super caller: every capability gate resolves. */
function grantCapability() {
  requireCanMock.mockResolvedValue({ tier: "super", side: "facility" })
}

/** Advanced/User caller: the capability gate throws like the real one. */
function denyCapability(message = "Managing members requires a Super User") {
  requireCanMock.mockRejectedValue(new AccessDeniedError(message))
}

describe("updateMemberAccessTier — access-tier gating", () => {
  it("rejects an invalid tier string with a zod error, before any DB write", async () => {
    grantCapability()
    await expect(
      updateMemberAccessTier("m-1", "godmode"),
    ).rejects.toThrow()

    // Zod parse happens first; no capability check, no member read/write.
    expect(requireCanMock).not.toHaveBeenCalled()
    expect(memberFindUniqueOrThrowMock).not.toHaveBeenCalled()
    expect(memberUpdateMock).not.toHaveBeenCalled()
  })

  it("throws and never writes when requireCan('members.manage') throws (Advanced/User caller)", async () => {
    denyCapability()

    await expect(
      updateMemberAccessTier("m-target", "advanced"),
    ).rejects.toThrow(/Super User/)

    expect(requireCanMock).toHaveBeenCalledWith("members.manage")
    expect(memberUpdateMock).not.toHaveBeenCalled()
  })

  it("Super caller + valid tier + owns the org → member.update with { accessTier }", async () => {
    grantCapability()
    // target member lookup
    memberFindUniqueOrThrowMock.mockResolvedValue({
      organizationId: "org-1",
      role: "member",
    })
    // assertCallerCanManage → caller is an admin/owner of org-1
    memberFindFirstMock.mockResolvedValue({ role: "owner" })
    memberUpdateMock.mockResolvedValue({})

    await expect(
      updateMemberAccessTier("m-target", "advanced"),
    ).resolves.toBeUndefined()

    expect(requireCanMock).toHaveBeenCalledWith("members.manage")
    expect(memberUpdateMock).toHaveBeenCalledOnce()
    expect(memberUpdateMock).toHaveBeenCalledWith({
      where: { id: "m-target" },
      data: { accessTier: "advanced" },
    })
  })

  it("an admin caller cannot retier the OWNER (owner-protection) → throw, no update", async () => {
    grantCapability()
    memberFindUniqueOrThrowMock.mockResolvedValue({
      organizationId: "org-1",
      role: "owner", // target is the owner
    })
    // caller can manage the org but is only an admin
    memberFindFirstMock.mockResolvedValue({ role: "admin" })

    await expect(
      updateMemberAccessTier("m-owner", "user"),
    ).rejects.toThrow(/only the owner can modify the owner/)

    expect(memberUpdateMock).not.toHaveBeenCalled()
  })

  it("cross-org: caller not a member of the target's org → throw (assertCallerCanManage)", async () => {
    grantCapability()
    memberFindUniqueOrThrowMock.mockResolvedValue({
      organizationId: "org-foreign",
      role: "member",
    })
    // assertCallerIsMember miss → not a member of org-foreign
    memberFindFirstMock.mockResolvedValue(null)

    await expect(
      updateMemberAccessTier("m-foreign", "super"),
    ).rejects.toThrow(/not a member of this organization/)

    expect(memberUpdateMock).not.toHaveBeenCalled()
  })
})

describe("settings-write actions — requireCan('settings.manage') gate", () => {
  const facilityInput = {
    name: "Lighthouse Surgical Center",
    type: "asc",
    address: "1 Beacon St",
    city: "Boston",
    state: "MA",
    zip: "02108",
    beds: 12,
  } as never

  describe("updateFacilityProfile", () => {
    it("throws and never writes when settings.manage is denied (Advanced/User)", async () => {
      requireFacilityMock.mockResolvedValue({ facility: { id: "fac-1" } })
      denyCapability("Settings access requires a Super User")

      await expect(
        updateFacilityProfile("fac-1", facilityInput),
      ).rejects.toThrow(/Super User/)

      expect(requireCanMock).toHaveBeenCalledWith("settings.manage")
      expect(facilityUpdateMock).not.toHaveBeenCalled()
    })

    it("writes when settings.manage resolves (Super)", async () => {
      requireFacilityMock.mockResolvedValue({ facility: { id: "fac-1" } })
      grantCapability()
      facilityUpdateMock.mockResolvedValue({})

      await expect(
        updateFacilityProfile("fac-1", facilityInput),
      ).resolves.toBeUndefined()

      expect(requireCanMock).toHaveBeenCalledWith("settings.manage")
      expect(facilityUpdateMock).toHaveBeenCalledOnce()
      expect(facilityUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "fac-1" } }),
      )
    })
  })

  describe("updateFeatureFlags", () => {
    const flags = { caseCostingEnabled: false } as never

    it("throws and never writes when settings.manage is denied (Advanced/User)", async () => {
      requireFacilityMock.mockResolvedValue({ facility: { id: "fac-1" } })
      denyCapability("Settings access requires a Super User")

      await expect(
        updateFeatureFlags("fac-1", flags),
      ).rejects.toThrow(/Super User/)

      expect(requireCanMock).toHaveBeenCalledWith("settings.manage")
      expect(featureFlagUpsertMock).not.toHaveBeenCalled()
    })

    it("upserts when settings.manage resolves (Super)", async () => {
      requireFacilityMock.mockResolvedValue({ facility: { id: "fac-1" } })
      grantCapability()
      featureFlagUpsertMock.mockResolvedValue({})

      await expect(
        updateFeatureFlags("fac-1", flags),
      ).resolves.toBeUndefined()

      expect(requireCanMock).toHaveBeenCalledWith("settings.manage")
      expect(featureFlagUpsertMock).toHaveBeenCalledOnce()
      expect(featureFlagUpsertMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { facilityId: "fac-1" } }),
      )
    })
  })
})

describe("member-write actions — requireCan('members.manage') gate", () => {
  describe("inviteTeamMember", () => {
    it("throws and never calls createInvitation when members.manage is denied", async () => {
      denyCapability()

      await expect(
        inviteTeamMember({
          organizationId: "org-1",
          email: "new@example.com",
          role: "admin",
        }),
      ).rejects.toThrow(/Super User/)

      expect(requireCanMock).toHaveBeenCalledWith("members.manage")
      expect(authCreateInvitationMock).not.toHaveBeenCalled()
    })

    it("invites when members.manage resolves (Super) and caller can manage the org", async () => {
      grantCapability()
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      authCreateInvitationMock.mockResolvedValue({})

      await expect(
        inviteTeamMember({
          organizationId: "org-1",
          email: "new@example.com",
          role: "admin",
        }),
      ).resolves.toBeUndefined()

      expect(requireCanMock).toHaveBeenCalledWith("members.manage")
      expect(authCreateInvitationMock).toHaveBeenCalledOnce()
    })
  })
})
