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
  authGetSessionMock,
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
  authGetSessionMock: vi.fn(),
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
  },
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: authGetSessionMock } },
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

      expect(invitationCreateMock).not.toHaveBeenCalled()
    })

    it("accepts role: 'admin' from a member who can manage the org", async () => {
      asUser("u-admin", "facility")
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      invitationCreateMock.mockResolvedValue({})

      await expect(
        inviteTeamMember({
          organizationId: "org-1",
          email: "new@example.com",
          role: "admin",
        }),
      ).resolves.toBeUndefined()

      expect(invitationCreateMock).toHaveBeenCalledOnce()
    })
  })

  describe("C3a updateTeamMemberRole", () => {
    it("rejects when demoting the last admin", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({ organizationId: "org-1" })
      memberFindFirstMock.mockResolvedValue({ role: "owner" }) // caller can manage
      memberFindUniqueMock.mockResolvedValue({
        role: "owner",
        organizationId: "org-1",
      })
      memberCountMock.mockResolvedValue(1) // only one admin/owner left

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
      memberFindUniqueOrThrowMock.mockResolvedValue({ organizationId: "org-1" })
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "admin",
        organizationId: "org-1",
      })
      memberCountMock.mockResolvedValue(2)
      memberUpdateMock.mockResolvedValue({})

      await expect(
        updateTeamMemberRole("m-other", "member"),
      ).resolves.toBeUndefined()
      expect(memberUpdateMock).toHaveBeenCalledOnce()
    })
  })

  describe("C3b removeTeamMember", () => {
    it("rejects when removing the last admin", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({ organizationId: "org-1" })
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "owner",
        organizationId: "org-1",
      })
      memberCountMock.mockResolvedValue(1)

      await expect(removeTeamMember("m-self")).rejects.toThrow(
        /Cannot remove the last admin of this organization/,
      )
      expect(memberDeleteMock).not.toHaveBeenCalled()
    })

    it("permits removing a non-admin member", async () => {
      asUser("u-owner", "facility")
      memberFindUniqueOrThrowMock.mockResolvedValue({ organizationId: "org-1" })
      memberFindFirstMock.mockResolvedValue({ role: "owner" })
      memberFindUniqueMock.mockResolvedValue({
        role: "member",
        organizationId: "org-1",
      })
      memberDeleteMock.mockResolvedValue({})

      await expect(removeTeamMember("m-other")).resolves.toBeUndefined()
      expect(memberDeleteMock).toHaveBeenCalledOnce()
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

  describe("M1 updateVendorProfile", () => {
    it("rejects when caller is a vendor (not admin UserRole)", async () => {
      // requireAdmin → requireRole("admin") will redirect (we mock as throw).
      authGetSessionMock.mockResolvedValue({ user: { id: "u-vendor" } })
      userFindUniqueMock.mockResolvedValue({ role: "vendor" })

      await expect(
        updateVendorProfile("v-1", {
          name: "Hijack Co",
          contactEmail: "attacker@example.com",
        } as never),
      ).rejects.toThrow(/REDIRECT:/)

      expect(vendorUpdateMock).not.toHaveBeenCalled()
    })
  })
})
