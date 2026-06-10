import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Charles audit — settings.ts role-escalation BLOCKER coverage.
 *
 * These tests exercise the security boundary, not the business logic:
 * - C1 inviteVendorTeamMember cross-org guard
 * - C2 inviteTeamMember role enum (no "owner")
 * - C3a updateTeamMemberRole last-admin protection
 * - C3b removeTeamMember last-admin protection
 * - B3  getVendorTeamMembers cross-org guard
 * - M1  updateVendorProfile requires admin (UserRole)
 *
 * The mocks are small on purpose — each test stubs only the prisma
 * lookups its action touches.
 */

const {
  memberFindFirstMock,
  memberFindManyMock,
  memberFindUniqueMock,
  memberFindUniqueOrThrowMock,
  memberCountMock,
  memberDeleteMock,
  memberUpdateMock,
  invitationCreateMock,
  vendorFindUniqueOrThrowMock,
  vendorUpdateMock,
  userFindUniqueMock,
  organizationUpdateMock,
  authGetSessionMock,
  authCreateInvitationMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindUniqueOrThrowMock: vi.fn(),
  memberCountMock: vi.fn(),
  memberDeleteMock: vi.fn(),
  memberUpdateMock: vi.fn(),
  invitationCreateMock: vi.fn(),
  vendorFindUniqueOrThrowMock: vi.fn(),
  vendorUpdateMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  organizationUpdateMock: vi.fn(),
  authGetSessionMock: vi.fn(),
  authCreateInvitationMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    member: {
      findFirst: memberFindFirstMock,
      findMany: memberFindManyMock,
      findUnique: memberFindUniqueMock,
      findUniqueOrThrow: memberFindUniqueOrThrowMock,
      count: memberCountMock,
      delete: memberDeleteMock,
      update: memberUpdateMock,
    },
    invitation: { create: invitationCreateMock },
    vendor: {
      findUniqueOrThrow: vendorFindUniqueOrThrowMock,
      update: vendorUpdateMock,
    },
    user: { findUnique: userFindUniqueMock },
    organization: { update: organizationUpdateMock },
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

vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`)
  },
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import {
  inviteTeamMember,
  inviteVendorTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  getVendorTeamMembers,
  updateVendorProfile,
  updateNotificationPreferences,
} from "@/lib/actions/settings"

beforeEach(() => {
  vi.clearAllMocks()
})

function asUser(userId: string, role: "facility" | "vendor" | "admin") {
  authGetSessionMock.mockResolvedValue({ user: { id: userId } })
  userFindUniqueMock.mockResolvedValue({ role })
}

describe("Charles audit — settings.ts role-escalation gates", () => {
  describe("C1 inviteVendorTeamMember", () => {
    it("rejects when caller is not a member of the target organization", async () => {
      asUser("u-stryker", "vendor")
      // assertCallerCanManage → assertCallerIsMember miss
      memberFindFirstMock.mockResolvedValue(null)

      await expect(
        inviteVendorTeamMember({
          organizationId: "org-medtronic",
          email: "attacker@example.com",
          role: "admin",
          subRole: "owner",
        }),
      ).rejects.toThrow(/Not authorized: not a member of this organization/)

      expect(authCreateInvitationMock).not.toHaveBeenCalled()
      expect(invitationCreateMock).not.toHaveBeenCalled()
    })

    it("rejects colon-injection in role / subRole", async () => {
      asUser("u-stryker", "vendor")
      await expect(
        inviteVendorTeamMember({
          organizationId: "org-x",
          email: "a@b.com",
          role: "admin",
          subRole: "owner:owner",
        }),
      ).rejects.toThrow()
      expect(authCreateInvitationMock).not.toHaveBeenCalled()
      expect(invitationCreateMock).not.toHaveBeenCalled()
    })
  })

  describe("C2 inviteTeamMember", () => {
    it("rejects role: 'owner' with a zod parse error", async () => {
      asUser("u-admin", "facility")
      await expect(
        inviteTeamMember({
          organizationId: "org-1",
          email: "new@example.com",
          role: "owner",
        }),
      ).rejects.toThrow()

      expect(authCreateInvitationMock).not.toHaveBeenCalled()
      expect(invitationCreateMock).not.toHaveBeenCalled()
    })

    it("accepts role: 'admin' from a member who can manage the org", async () => {
      asUser("u-admin", "facility")
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      authCreateInvitationMock.mockResolvedValue({})

      await expect(
        inviteTeamMember({
          organizationId: "org-1",
          email: "new@example.com",
          role: "admin",
        }),
      ).resolves.toBeUndefined()

      expect(authCreateInvitationMock).toHaveBeenCalledOnce()
      expect(authCreateInvitationMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            email: "new@example.com",
            role: "admin",
            organizationId: "org-1",
          }),
        }),
      )
    })
  })

  describe("C3a updateTeamMemberRole", () => {
    it("rejects when demoting the last admin", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-1",
        role: "owner",
      })
      memberFindFirstMock.mockResolvedValue({ role: "owner" }) // caller can manage
      memberFindUniqueMock.mockResolvedValue({
        role: "owner",
        organizationId: "org-1",
      })
      memberFindManyMock.mockResolvedValue([{ role: "owner" }]) // only one admin/owner left

      await expect(
        updateTeamMemberRole("m-self", "member"),
      ).rejects.toThrow(/Cannot remove the last admin of this organization/)

      expect(memberUpdateMock).not.toHaveBeenCalled()
    })

    it("rejects role enum that isn't admin|member", async () => {
      asUser("u-owner", "facility")
      await expect(
        updateTeamMemberRole("m-self", "owner"),
      ).rejects.toThrow()
      expect(memberUpdateMock).not.toHaveBeenCalled()
    })

    it("permits demotion when there is more than one admin", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-1",
        role: "admin",
      })
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "admin",
        organizationId: "org-1",
      })
      memberFindManyMock.mockResolvedValue([{ role: "owner" }, { role: "admin" }])
      memberUpdateMock.mockResolvedValue({})

      await expect(
        updateTeamMemberRole("m-other", "member"),
      ).resolves.toBeUndefined()
      expect(memberUpdateMock).toHaveBeenCalledOnce()
    })

    it("2026-06-09: an ADMIN cannot demote the OWNER", async () => {
      asUser("u-admin", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-1",
        role: "owner", // target is the owner
      })
      memberFindFirstMock.mockResolvedValue({ role: "admin" }) // caller is admin

      await expect(
        updateTeamMemberRole("m-owner", "member"),
      ).rejects.toThrow(/only the owner can modify the owner/)
      expect(memberUpdateMock).not.toHaveBeenCalled()
    })
  })

  describe("C3b removeTeamMember", () => {
    it("rejects when removing the last admin", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-1",
        role: "owner",
      })
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "owner",
        organizationId: "org-1",
      })
      memberFindManyMock.mockResolvedValue([{ role: "owner" }])

      await expect(removeTeamMember("m-self")).rejects.toThrow(
        /Cannot remove the last admin of this organization/,
      )
      expect(memberDeleteMock).not.toHaveBeenCalled()
    })

    it("permits removing a non-admin member", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-1",
        role: "member",
      })
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "member",
        organizationId: "org-1",
      })
      memberDeleteMock.mockResolvedValue({})

      await expect(removeTeamMember("m-other")).resolves.toBeUndefined()
      expect(memberDeleteMock).toHaveBeenCalledOnce()
    })

    it("2026-06-09: an ADMIN cannot remove the OWNER", async () => {
      asUser("u-admin", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-1",
        role: "owner",
      })
      memberFindFirstMock.mockResolvedValue({ role: "admin" })

      await expect(removeTeamMember("m-owner")).rejects.toThrow(
        /only the owner can modify the owner/,
      )
      expect(memberDeleteMock).not.toHaveBeenCalled()
    })

    it("2026-06-09: last-admin protection counts vendor sub-roled admins by BASE segment", async () => {
      // Vendor org where the only admin is "admin:owner" — pre-fix the
      // raw `role IN ('admin','owner')` count missed sub-roled admins
      // entirely (target early-returned, no protection).
      asUser("u-vendor-admin", "vendor")
      memberFindUniqueOrThrowMock.mockResolvedValue({
        organizationId: "org-v",
        role: "admin:owner",
      })
      memberFindFirstMock.mockResolvedValue({ role: "admin:owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "admin:owner",
        organizationId: "org-v",
      })
      memberFindManyMock.mockResolvedValue([
        { role: "admin:owner" },
        { role: "member:sales" },
      ])

      await expect(removeTeamMember("m-v-admin")).rejects.toThrow(
        /Cannot remove the last admin of this organization/,
      )
      expect(memberDeleteMock).not.toHaveBeenCalled()
    })
  })

  describe("B3 getVendorTeamMembers", () => {
    it("rejects when the caller is not a member of the target organization", async () => {
      asUser("u-stryker", "vendor")
      // requireVendor's lookup
      memberFindFirstMock
        .mockResolvedValueOnce({
          organization: { vendor: { id: "v-stryker" } },
        })
        // assertCallerIsMember miss
        .mockResolvedValueOnce(null)

      await expect(
        getVendorTeamMembers("org-medtronic"),
      ).rejects.toThrow(/Not authorized: not a member of this organization/)

      expect(memberFindManyMock).not.toHaveBeenCalled()
    })
  })

  describe("M1 updateVendorProfile (re-gated 2026-06-09)", () => {
    const input = {
      name: "Acme Surgical",
      contactEmail: "contact@acme.com",
    } as never

    it("platform admin may update any vendor by id", async () => {
      asUser("u-admin", "admin")
      vendorFindUniqueOrThrowMock.mockResolvedValue({ id: "v-any" })
      vendorUpdateMock.mockResolvedValue({})

      await expect(updateVendorProfile("v-any", input)).resolves.toBeUndefined()
      expect(vendorUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "v-any" } }),
      )
    })

    it("vendor org admin updates their OWN vendor — client-supplied id ignored", async () => {
      asUser("u-vendor-admin", "vendor")
      memberFindFirstMock.mockResolvedValue({
        role: "admin:owner",
        organization: { vendor: { id: "v-own" } },
      })
      vendorUpdateMock.mockResolvedValue({})

      // Caller passes a FOREIGN vendor id; the write must target v-own.
      await expect(
        updateVendorProfile("v-foreign", input),
      ).resolves.toBeUndefined()
      expect(vendorUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "v-own" } }),
      )
      expect(vendorFindUniqueOrThrowMock).not.toHaveBeenCalled()
    })

    it("rejects a plain vendor member (shared-write restriction)", async () => {
      asUser("u-vendor-member", "vendor")
      memberFindFirstMock.mockResolvedValue({
        role: "member",
        organization: { vendor: { id: "v-own" } },
      })

      await expect(updateVendorProfile("v-own", input)).rejects.toThrow(
        /requires admin or owner role/,
      )
      expect(vendorUpdateMock).not.toHaveBeenCalled()
    })

    it("rejects a facility user", async () => {
      asUser("u-facility", "facility")

      await expect(updateVendorProfile("v-1", input)).rejects.toThrow(
        /requires admin or vendor organization admin/,
      )
      expect(vendorUpdateMock).not.toHaveBeenCalled()
    })
  })

  describe("2026-06-09 notification prefs — session-scoped (BLOCKER class 2)", () => {
    const PREFS = {
      expiringContracts: true,
      tierThresholds: true,
      rebateDue: false,
      paymentDue: true,
      offContract: true,
      pricingErrors: true,
      compliance: true,
      emailEnabled: false,
      inAppEnabled: true,
    }

    it("updateNotificationPreferences writes the SESSION org, ignoring the entityId param", async () => {
      authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
      memberFindFirstMock.mockResolvedValue({
        organizationId: "org-session",
        organization: { metadata: JSON.stringify({ keep: "me" }) },
      })
      organizationUpdateMock.mockResolvedValue({})

      await updateNotificationPreferences("fac-FOREIGN", PREFS)

      expect(organizationUpdateMock).toHaveBeenCalledOnce()
      const call = organizationUpdateMock.mock.calls[0][0]
      expect(call.where).toEqual({ id: "org-session" })
      const written = JSON.parse(call.data.metadata)
      expect(written.keep).toBe("me") // other metadata keys preserved
      expect(written.notificationPrefs).toEqual(PREFS)
    })

    it("rejects a malformed prefs payload before any DB write (zod)", async () => {
      await expect(
        updateNotificationPreferences("any", {
          emailEnabled: "yes-please",
        } as never),
      ).rejects.toThrow()
      expect(organizationUpdateMock).not.toHaveBeenCalled()
    })

    it("no-ops when the caller has no organization", async () => {
      authGetSessionMock.mockResolvedValue({ user: { id: "u-orphan" } })
      memberFindFirstMock.mockResolvedValue(null)

      await expect(
        updateNotificationPreferences("fac-x", PREFS),
      ).resolves.toBeUndefined()
      expect(organizationUpdateMock).not.toHaveBeenCalled()
    })
  })
})
