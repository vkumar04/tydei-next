import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * Guards on the admin portal's destructive actions (audit 2026-07-26).
 *
 * `adminDeleteUser` / `adminBulkDeleteUsers` had `requireAdmin()` and nothing
 * else — no self-delete check and no last-admin check. The org-level
 * equivalent already had both (`_hookBeforeRemoveMember` in auth-server.ts);
 * the platform-level one did not.
 *
 * The last-admin case is not hypothetical: production has exactly ONE user
 * with `UserRole: admin`, and it is the seeded demo account that launch
 * hardening instructs you to delete. `/admin` is gated on that role, so doing
 * it would make the operator console permanently unreachable with no
 * self-service recovery.
 *
 * A Server Action is reachable by anyone who can POST to it, so "the UI
 * doesn't offer bulk delete" is not a control — the checks live server-side.
 */

const userDelete = vi.fn()
const userDeleteMany = vi.fn()
const userFindMany = vi.fn()
const userFindUnique = vi.fn()
const userCount = vi.fn()
const logAudit = vi.fn()

vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ user: { id: "caller-admin" } }),
}))
vi.mock("@/lib/auth-server", () => ({ auth: { api: {}, $context: Promise.resolve({}) } }))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      get delete() { return userDelete },
      get deleteMany() { return userDeleteMany },
      get findMany() { return userFindMany },
      get findUnique() { return userFindUnique },
      get count() { return userCount },
    },
  },
}))
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { adminDeleteUser, adminBulkDeleteUsers } from "@/lib/actions/admin/users"

beforeEach(() => {
  vi.clearAllMocks()
  userDelete.mockResolvedValue({})
  userDeleteMany.mockResolvedValue({ count: 1 })
  userFindUnique.mockResolvedValue({ email: "target@x.com", role: "facility" })
  userFindMany.mockResolvedValue([{ id: "target", role: "facility" }])
  userCount.mockResolvedValue(3)
})

describe("adminDeleteUser", () => {
  it("refuses to delete the caller's own account", async () => {
    await expect(adminDeleteUser("caller-admin")).rejects.toThrow(
      /cannot delete your own account/i,
    )
    expect(userDelete).not.toHaveBeenCalled()
  })

  it("refuses to remove the last platform admin", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "the-admin", role: "admin" }])
    userCount.mockResolvedValueOnce(1) // this is the only admin
    await expect(adminDeleteUser("the-admin")).rejects.toThrow(/last platform admin/i)
    expect(
      userDelete,
      "deleting the only admin would make /admin permanently unreachable",
    ).not.toHaveBeenCalled()
  })

  it("allows removing an admin while others remain", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "other-admin", role: "admin" }])
    userCount.mockResolvedValueOnce(2)
    await adminDeleteUser("other-admin")
    expect(userDelete).toHaveBeenCalledTimes(1)
  })

  it("deletes an ordinary user and records an audit entry", async () => {
    await adminDeleteUser("target")
    expect(userDelete).toHaveBeenCalledTimes(1)
    // Deletion was previously the only admin mutation with no audit trail.
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.deleted", entityId: "target" }),
    )
  })
})

describe("adminBulkDeleteUsers", () => {
  it("refuses a batch containing the caller", async () => {
    await expect(
      adminBulkDeleteUsers(["someone", "caller-admin"]),
    ).rejects.toThrow(/cannot delete your own account/i)
    expect(userDeleteMany).not.toHaveBeenCalled()
  })

  it("refuses a batch that would drain the admins", async () => {
    userFindMany.mockResolvedValueOnce([
      { id: "a1", role: "admin" },
      { id: "a2", role: "admin" },
    ])
    userCount.mockResolvedValueOnce(2)
    await expect(adminBulkDeleteUsers(["a1", "a2"])).rejects.toThrow(
      /last platform admin/i,
    )
    expect(userDeleteMany).not.toHaveBeenCalled()
  })

  it("deletes a safe batch and audits it", async () => {
    userFindMany.mockResolvedValueOnce([
      { id: "u1", role: "facility" },
      { id: "u2", role: "vendor" },
    ])
    const result = await adminBulkDeleteUsers(["u1", "u2"])
    expect(userDeleteMany).toHaveBeenCalledTimes(1)
    expect(result.deleted).toBe(1)
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.bulk_deleted" }),
    )
  })
})
