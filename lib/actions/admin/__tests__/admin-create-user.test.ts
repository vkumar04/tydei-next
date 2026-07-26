import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * Regression cover for the three ways `adminCreateUser` produced an unusable
 * account (found 2026-07-26, after a real admin-portal invite reached nobody):
 *
 *   1. the form's password was destructured away, so no credential Account
 *      existed and there was nothing to sign in with;
 *   2. no email was ever sent;
 *   3. the email was stored verbatim, and better-auth's findUserByEmail
 *      lowercases its input before an exact match on a plain `text` column —
 *      so a mixed-case address was invisible to sign-in AND to password
 *      reset, which fails silently by design.
 *
 * Routing through `auth.api.signUpEmail` fixes all three, so these assert the
 * routing rather than re-testing better-auth internals.
 */

const signUpEmail = vi.fn()
const userUpdate = vi.fn()
const logAudit = vi.fn()

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { get signUpEmail() { return signUpEmail } } },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}))
vi.mock("@/lib/db", () => ({
  prisma: { user: { get update() { return userUpdate } } },
}))
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { adminCreateUser } from "@/lib/actions/admin/users"

beforeEach(() => {
  vi.clearAllMocks()
  signUpEmail.mockResolvedValue({ user: { id: "user-1" } })
  userUpdate.mockImplementation(({ data }: { data: { role: string } }) =>
    Promise.resolve({
      id: "user-1",
      name: "Vick",
      email: "vick.kumar19@gmail.com",
      role: data.role,
      createdAt: new Date(),
    }),
  )
})

describe("adminCreateUser", () => {
  it("creates through better-auth so a real credential exists", async () => {
    await adminCreateUser({
      name: "Vick",
      email: "vick.kumar19@gmail.com",
      password: "correct-horse",
      role: "admin",
    })
    expect(
      signUpEmail,
      "must go through better-auth — prisma.user.create writes no credential " +
        "Account, leaving the user unable to sign in",
    ).toHaveBeenCalledTimes(1)
    // The password the form collects must actually be used, not discarded.
    expect(signUpEmail.mock.calls[0][0].body.password).toBe("correct-horse")
  })

  it("lowercases the email so auth lookups can find the account", async () => {
    await adminCreateUser({
      name: "Vick",
      email: "  Vick.Kumar19@Gmail.com  ",
      password: "correct-horse",
      role: "admin",
    })
    expect(
      signUpEmail.mock.calls[0][0].body.email,
      "a mixed-case address is invisible to every better-auth lookup",
    ).toBe("vick.kumar19@gmail.com")
  })

  it("applies the requested role, which better-auth knows nothing about", async () => {
    const result = await adminCreateUser({
      name: "Vick",
      email: "v@example.com",
      password: "correct-horse",
      role: "admin",
    })
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-1" },
        data: { role: "admin" },
      }),
    )
    // Without the follow-up update every admin-created user silently lands
    // on the schema default (`facility`).
    expect(result.role).toBe("admin")
  })

  it.each(["facility", "vendor", "admin"] as const)(
    "sends mail for role %s (better-auth's verification email)",
    async (role) => {
      await adminCreateUser({
        name: "X",
        email: `${role}@example.com`,
        password: "correct-horse",
        role,
      })
      // signUpEmail is what triggers sendVerificationEmail, because
      // sendOnSignUp falls back to requireEmailVerification (true).
      // Every role goes through it — no role-conditional shortcut.
      expect(signUpEmail).toHaveBeenCalledTimes(1)
    },
  )

  it("surfaces a readable error instead of a raw better-auth throw", async () => {
    signUpEmail.mockRejectedValueOnce(new Error("User already exists"))
    await expect(
      adminCreateUser({
        name: "X",
        email: "dupe@example.com",
        password: "correct-horse",
        role: "facility",
      }),
    ).rejects.toThrow(/already exists/i)
  })
})
