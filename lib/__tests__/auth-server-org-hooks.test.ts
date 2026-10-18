import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * better-auth organizationHooks defense-in-depth.
 *
 * Charles audit C2/C3 hardened the hand-rolled action surface in
 * lib/actions/settings.ts. These tests cover the platform-wide
 * complement: the org-plugin hooks that fire on every
 * `auth.api.createInvitation` / `acceptInvitation` /
 * `updateMemberRole` / `removeMember` call regardless of caller.
 *
 * The hook closures import the helper functions exported below
 * (no parallel source of truth — same code path).
 */

const { memberFindManyMock, memberFindFirstMock, memberUpdateMock, userFindUniqueMock } = vi.hoisted(() => ({
  memberFindManyMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  memberUpdateMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  // 2026-06-09 settings audit: the hook now counts admins by BASE role
  // segment in JS (findMany + filter), because a raw Prisma
  // `role IN ('admin','owner')` count misses vendor sub-roled admins.
  prisma: {
    member: { findMany: memberFindManyMock, findFirst: memberFindFirstMock, update: memberUpdateMock },
    user: { findUnique: userFindUniqueMock },
  },
}))

import {
  _hookBeforeCreateInvitation,
  _hookBeforeAcceptInvitation,
  _hookBeforeUpdateMemberRole,
  _hookBeforeRemoveMember,
  _hookAssertActorCan,
  _hookAfterAcceptInvitation,
  ORG_HTTP_DISABLED_PATHS,
} from "@/lib/auth-server"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("organizationHooks — invitation role enum", () => {
  it("beforeCreateInvitation rejects role 'owner'", async () => {
    await expect(_hookBeforeCreateInvitation("owner")).rejects.toThrow(
      /Invalid role/,
    )
  })

  it("beforeCreateInvitation rejects an arbitrary string", async () => {
    await expect(_hookBeforeCreateInvitation("super-admin")).rejects.toThrow(
      /Invalid role/,
    )
  })

  it("beforeCreateInvitation accepts admin / member", async () => {
    await expect(_hookBeforeCreateInvitation("admin")).resolves.toBeUndefined()
    await expect(_hookBeforeCreateInvitation("member")).resolves.toBeUndefined()
  })

  it("beforeCreateInvitation validates the BASE role for vendor sub-role concatenation", async () => {
    // "admin:salesEng" — base is "admin", allowed.
    await expect(
      _hookBeforeCreateInvitation("admin:salesEng"),
    ).resolves.toBeUndefined()
    // "owner:owner" — base is "owner", rejected. This is the
    // colon-injection vector that Stryker exploited pre-fix.
    await expect(
      _hookBeforeCreateInvitation("owner:owner"),
    ).rejects.toThrow(/Invalid role/)
  })

  it("beforeAcceptInvitation re-validates (closes window between create + accept)", async () => {
    await expect(_hookBeforeAcceptInvitation("owner")).rejects.toThrow(
      /Invalid role/,
    )
    await expect(_hookBeforeAcceptInvitation("admin")).resolves.toBeUndefined()
    // null role on a legacy row is allowed — better-auth defaults
    // to "member", which is safe.
    await expect(_hookBeforeAcceptInvitation(null)).resolves.toBeUndefined()
    await expect(_hookBeforeAcceptInvitation(undefined)).resolves.toBeUndefined()
  })
})

describe("organizationHooks — updateMemberRole", () => {
  it("rejects newRole 'owner' (admin self-promotion vector)", async () => {
    await expect(_hookBeforeUpdateMemberRole("owner")).rejects.toThrow(
      /Invalid role/,
    )
  })

  it("rejects an arbitrary string newRole", async () => {
    await expect(_hookBeforeUpdateMemberRole("super-admin")).rejects.toThrow(
      /Invalid role/,
    )
  })

  it("accepts admin / member", async () => {
    await expect(_hookBeforeUpdateMemberRole("admin")).resolves.toBeUndefined()
    await expect(_hookBeforeUpdateMemberRole("member")).resolves.toBeUndefined()
  })
})

describe("organizationHooks — removeMember last-admin protection", () => {
  it("rejects when removing the last admin of the org", async () => {
    memberFindManyMock.mockResolvedValue([{ role: "admin" }, { role: "member" }])
    await expect(
      _hookBeforeRemoveMember({
        memberRole: "admin",
        memberId: "m-1",
        organizationId: "org-1",
      }),
    ).rejects.toThrow(/Cannot remove the last admin/)
  })

  it("rejects when removing the last owner of the org", async () => {
    memberFindManyMock.mockResolvedValue([{ role: "owner" }, { role: "member" }])
    await expect(
      _hookBeforeRemoveMember({
        memberRole: "owner",
        memberId: "m-1",
        organizationId: "org-1",
      }),
    ).rejects.toThrow(/Cannot remove the last admin/)
  })

  it("permits removing an admin when more than one remains", async () => {
    memberFindManyMock.mockResolvedValue([
      { role: "owner" },
      { role: "admin" },
      { role: "admin:salesEng" },
    ])
    await expect(
      _hookBeforeRemoveMember({
        memberRole: "admin",
        memberId: "m-1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined()
  })

  it("skips the count probe for non-admin members (perf + correctness)", async () => {
    await expect(
      _hookBeforeRemoveMember({
        memberRole: "member",
        memberId: "m-1",
        organizationId: "org-1",
      }),
    ).resolves.toBeUndefined()
    expect(memberFindManyMock).not.toHaveBeenCalled()
  })

  it("counts vendor sub-roled admins by BASE segment (2026-06-09)", async () => {
    // Two admins, both sub-roled — removal of one must be permitted.
    memberFindManyMock.mockResolvedValue([
      { role: "admin:owner" },
      { role: "admin:salesEng" },
    ])
    await expect(
      _hookBeforeRemoveMember({
        memberRole: "admin:owner",
        memberId: "m-1",
        organizationId: "org-v",
      }),
    ).resolves.toBeUndefined()

    // Lone sub-roled admin — removal must be blocked (pre-fix the IN
    // count returned 0 and, worse, settings.ts skipped protection
    // entirely for sub-roled targets).
    memberFindManyMock.mockResolvedValue([
      { role: "admin:owner" },
      { role: "member:sales" },
    ])
    await expect(
      _hookBeforeRemoveMember({
        memberRole: "admin:owner",
        memberId: "m-1",
        organizationId: "org-v",
      }),
    ).rejects.toThrow(/Cannot remove the last admin/)
  })
})

describe("organizationHooks — actor access tier", () => {
  const args = { userId: "u-1", organizationId: "org-1", permission: "members.manage" as const }

  it("allows a Super member of the target org", async () => {
    userFindUniqueMock.mockResolvedValue({ role: "facility" })
    memberFindFirstMock.mockResolvedValue({ accessTier: "super" })
    await expect(_hookAssertActorCan(args)).resolves.toBeUndefined()
    expect(memberFindFirstMock).toHaveBeenCalledWith({
      where: { userId: "u-1", organizationId: "org-1" },
      select: { accessTier: true },
    })
  })

  it("rejects an Advanced or read-only member even when their org role is admin", async () => {
    userFindUniqueMock.mockResolvedValue({ role: "facility" })
    for (const accessTier of ["advanced", "user"]) {
      memberFindFirstMock.mockResolvedValue({ accessTier })
      await expect(_hookAssertActorCan(args)).rejects.toThrow(/permission/)
    }
  })

  it("rejects a caller with no membership in the target org", async () => {
    userFindUniqueMock.mockResolvedValue({ role: "facility" })
    memberFindFirstMock.mockResolvedValue(null)
    await expect(_hookAssertActorCan(args)).rejects.toThrow(/permission/)
  })

  it("allows a platform admin", async () => {
    userFindUniqueMock.mockResolvedValue({ role: "admin" })
    memberFindFirstMock.mockResolvedValue(null)
    await expect(_hookAssertActorCan(args)).resolves.toBeUndefined()
  })
})

describe("organizationHooks — accepted invitations start read-only", () => {
  it("sets the new member's access tier to user", async () => {
    memberUpdateMock.mockResolvedValue({})
    await _hookAfterAcceptInvitation("m-new")
    expect(memberUpdateMock).toHaveBeenCalledWith({
      where: { id: "m-new" },
      data: { accessTier: "user" },
    })
  })
})

describe("org plugin HTTP surface", () => {
  it("disables every member-management and org-mutation endpoint", () => {
    for (const path of [
      "/organization/create",
      "/organization/update",
      "/organization/delete",
      "/organization/invite-member",
      "/organization/remove-member",
      "/organization/update-member-role",
      "/organization/set-active",
      "/organization/list-members",
    ]) {
      expect(ORG_HTTP_DISABLED_PATHS).toContain(path)
    }
  })

  it("keeps the invitation accept / reject / lookup endpoints the UI calls", () => {
    for (const path of [
      "/organization/accept-invitation",
      "/organization/reject-invitation",
      "/organization/get-invitation",
    ]) {
      expect(ORG_HTTP_DISABLED_PATHS).not.toContain(path)
    }
  })
})
