import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * User lifecycle: delete, deactivate, role change, email change.
 *
 * Every case here comes from the 2026-07-26 audit, verified against
 * production data:
 *
 *  - `/admin` is gated on `UserRole: admin` and prod runs with exactly ONE
 *    admin. Removing it — by delete, by deactivation, or by demotion — makes
 *    the operator console unreachable with no self-service recovery. Guarding
 *    only delete just moves the door.
 *  - audit_log.userId is RESTRICT, and prod has an account with 468 audit
 *    rows. Hard delete throws a raw FK error for anyone who has done
 *    anything; deactivation is the real offboarding path.
 *  - Sessions live 7 days with a 5-minute cookie cache, and there were 10
 *    live ones. A demotion that leaves them running isn't a demotion.
 *  - An admin can change any email with no confirmation, so change-then-reset
 *    is a full takeover. The former address has to be told.
 */

const userFindMany = vi.fn()
const userFindUnique = vi.fn()
const userCount = vi.fn()
const userUpdate = vi.fn()
const userDelete = vi.fn()
const userDeleteMany = vi.fn()
const sessionDeleteMany = vi.fn()
const auditGroupBy = vi.fn()
const renewalNoteCount = vi.fn()
const insightFlagCount = vi.fn()
const logAudit = vi.fn()
const sendEmail = vi.fn()
const adminEmailChangedEmail = vi.fn()

vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ user: { id: "caller-admin", name: "Admin Demo" } }),
}))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: {}, $context: Promise.resolve({}) },
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      get findMany() { return userFindMany },
      get findUnique() { return userFindUnique },
      get count() { return userCount },
      get update() { return userUpdate },
      get delete() { return userDelete },
      get deleteMany() { return userDeleteMany },
    },
    session: { get deleteMany() { return sessionDeleteMany } },
    auditLog: { get groupBy() { return auditGroupBy } },
    renewalNote: { get count() { return renewalNoteCount } },
    rebateInsightFlag: { get count() { return insightFlagCount } },
  },
}))
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))
vi.mock("@/lib/email", () => ({ sendEmail: (d: unknown) => sendEmail(d) }))
vi.mock("@/lib/emails/render", () => ({
  adminEmailChangedEmail: (p: unknown) => {
    adminEmailChangedEmail(p)
    return Promise.resolve({ subject: "s", html: "h", text: "t" })
  },
}))

import {
  adminDeleteUser,
  adminBulkDeleteUsers,
  adminSetUserActive,
  adminUpdateUser,
} from "@/lib/actions/admin/users"

/** No audit history, no other blockers — the deletable case. */
function noBlockers() {
  auditGroupBy.mockResolvedValue([])
  renewalNoteCount.mockResolvedValue(0)
  insightFlagCount.mockResolvedValue(0)
}

beforeEach(() => {
  vi.clearAllMocks()
  noBlockers()
  userFindMany.mockResolvedValue([])          // no admins among targets
  userCount.mockResolvedValue(3)
  userFindUnique.mockResolvedValue({ email: "t@x.com", name: "T", role: "facility" })
  userDelete.mockResolvedValue({})
  userDeleteMany.mockResolvedValue({ count: 1 })
  sessionDeleteMany.mockResolvedValue({ count: 2 })
  sendEmail.mockResolvedValue({})
  userUpdate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "u1",
      name: "T",
      email: (data.email as string) ?? "t@x.com",
      role: (data.role as string) ?? "facility",
      createdAt: new Date(),
      deactivatedAt: data.deactivatedAt ?? null,
    }),
  )
})

// ─── #1 delete vs deactivate ──────────────────────────────────────

describe("hard delete", () => {
  it("refuses when the user has audit history, and names deactivation", async () => {
    // mockResolvedValue, not ...Once: the assertion below invokes the action
    // twice, and a one-shot mock would let the second call see no blockers.
    auditGroupBy.mockResolvedValue([{ userId: "u1", _count: { _all: 468 } }])
    await expect(adminDeleteUser("u1")).rejects.toThrow(/468 audit-log entries/)
    await expect(adminDeleteUser("u1")).rejects.toThrow(/deactivate/i)
    expect(
      userDelete,
      "audit_log.userId is RESTRICT — this would throw a raw FK error anyway",
    ).not.toHaveBeenCalled()
  })

  it("also counts renewal notes and insight flags as blockers", async () => {
    renewalNoteCount.mockResolvedValueOnce(2)
    await expect(adminDeleteUser("u1")).rejects.toThrow(/2 renewal note/)
  })

  it("deletes a user with no history, revoking sessions first", async () => {
    await adminDeleteUser("u1")
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1)
    expect(userDelete).toHaveBeenCalledTimes(1)
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.deleted" }),
    )
  })

  it("allows deleting an admin while another remains", async () => {
    // Carried over from the superseded admin-delete-guards spec: the guard
    // must stop the LAST admin, not admins in general.
    userFindMany.mockResolvedValueOnce([{ id: "other-admin" }])
    userCount.mockResolvedValueOnce(2)
    await adminDeleteUser("other-admin")
    expect(userDelete).toHaveBeenCalledTimes(1)
  })

  it("refuses to delete the caller", async () => {
    await expect(adminDeleteUser("caller-admin")).rejects.toThrow(/your own account/i)
  })

  it("bulk delete is guarded even though the UI never calls it", async () => {
    auditGroupBy.mockResolvedValueOnce([{ userId: "a", _count: { _all: 5 } }])
    await expect(adminBulkDeleteUsers(["a", "b"])).rejects.toThrow(/can't be deleted/i)
    expect(userDeleteMany).not.toHaveBeenCalled()
  })
})

describe("deactivate", () => {
  it("stamps deactivatedAt and revokes every session", async () => {
    await adminSetUserActive("u1", false)
    const data = userUpdate.mock.calls[0][0].data
    expect(data.deactivatedAt).toBeInstanceOf(Date)
    expect(
      sessionDeleteMany,
      "a session that outlives deactivation makes it meaningless",
    ).toHaveBeenCalledWith({ where: { userId: { in: ["u1"] } } })
  })

  it("reactivating clears the stamp and does not revoke", async () => {
    await adminSetUserActive("u1", true)
    expect(userUpdate.mock.calls[0][0].data.deactivatedAt).toBeNull()
    expect(sessionDeleteMany).not.toHaveBeenCalled()
  })

  it("refuses to deactivate the last active admin", async () => {
    userFindMany.mockResolvedValueOnce([{ id: "the-admin" }])
    userCount.mockResolvedValueOnce(1)
    await expect(adminSetUserActive("the-admin", false)).rejects.toThrow(
      /last active platform admin/i,
    )
    expect(userUpdate).not.toHaveBeenCalled()
  })

  it("refuses to deactivate yourself", async () => {
    await expect(adminSetUserActive("caller-admin", false)).rejects.toThrow(
      /your own account/i,
    )
  })
})

// ─── #2 role change ───────────────────────────────────────────────

describe("role change", () => {
  it("refuses to demote the last admin", async () => {
    userFindUnique.mockResolvedValueOnce({ email: "a@x.com", name: "A", role: "admin" })
    userFindMany.mockResolvedValueOnce([{ id: "the-admin" }])
    userCount.mockResolvedValueOnce(1)
    await expect(
      adminUpdateUser("the-admin", { role: "facility" }),
    ).rejects.toThrow(/last active platform admin/i)
    expect(
      userUpdate,
      "demotion removes an admin exactly as deletion does",
    ).not.toHaveBeenCalled()
  })

  it("allows demotion while another admin remains, and revokes sessions", async () => {
    userFindUnique.mockResolvedValueOnce({ email: "a@x.com", name: "A", role: "admin" })
    userFindMany.mockResolvedValueOnce([{ id: "other" }])
    userCount.mockResolvedValueOnce(2)
    await adminUpdateUser("other", { role: "facility" })
    expect(userUpdate).toHaveBeenCalledTimes(1)
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1)
  })

  it("refuses to demote yourself", async () => {
    userFindUnique.mockResolvedValueOnce({
      email: "me@x.com", name: "Me", role: "admin",
    })
    await expect(
      adminUpdateUser("caller-admin", { role: "facility" }),
    ).rejects.toThrow(/your own account/i)
  })
})

// ─── #6 email change ──────────────────────────────────────────────

describe("email change", () => {
  it("notifies the PREVIOUS address and audits both values", async () => {
    userFindUnique.mockResolvedValueOnce({
      email: "old@x.com", name: "T", role: "facility",
    })
    await adminUpdateUser("u1", { email: "New@X.com" })

    expect(sendEmail.mock.calls[0][0].to).toBe("old@x.com")
    expect(adminEmailChangedEmail.mock.calls[0][0]).toMatchObject({
      previousEmail: "old@x.com",
      newEmail: "new@x.com", // normalized
    })
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "user.email_changed",
        metadata: expect.objectContaining({
          previousEmail: "old@x.com",
          newEmail: "new@x.com",
        }),
      }),
    )
  })

  it("revokes sessions so a hijacker's session doesn't survive the change", async () => {
    userFindUnique.mockResolvedValueOnce({
      email: "old@x.com", name: "T", role: "facility",
    })
    await adminUpdateUser("u1", { email: "new@x.com" })
    expect(sessionDeleteMany).toHaveBeenCalledTimes(1)
  })

  it("still applies the change when the warning email fails", async () => {
    userFindUnique.mockResolvedValueOnce({
      email: "old@x.com", name: "T", role: "facility",
    })
    sendEmail.mockRejectedValueOnce(new Error("Resend down"))
    const r = await adminUpdateUser("u1", { email: "new@x.com" })
    expect(r.email).toBe("new@x.com")
  })

  it("does not notify when the email is unchanged", async () => {
    userFindUnique.mockResolvedValueOnce({
      email: "same@x.com", name: "T", role: "facility",
    })
    await adminUpdateUser("u1", { email: "same@x.com", name: "New Name" })
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
