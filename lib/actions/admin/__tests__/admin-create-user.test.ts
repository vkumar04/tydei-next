import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * Regression cover for `adminCreateUser`.
 *
 * Round 1 (the account nobody could reach) — the original
 * `prisma.user.create({ ...userData, emailVerified: true })` was broken three
 * ways: it discarded the form's password so no credential Account existed, it
 * sent no email, and it stored the address verbatim — and better-auth's
 * `findUserByEmail` lowercases before an exact match on a plain `text`
 * column, so a mixed-case row was invisible to sign-in AND to password reset,
 * which fails silently by design.
 *
 * Round 2 (the fix's own bug) — routing through `auth.api.signUpEmail` looked
 * right but sends the verification email INSIDE the call and AFTER the user
 * row is committed (sign-up.mjs:246), so a mail failure threw out of a
 * half-finished create: user exists, role never applied, admin sees an error,
 * and the retry is then blocked by "already exists". Reproduced locally. It
 * also created a Session + setSessionCookie for the new user
 * (sign-up.mjs:256-261) — inert only because `nextCookies()` isn't installed.
 *
 * Creation now goes through better-auth's internal context, and the email is
 * sent afterwards, best-effort.
 */

const hash = vi.fn()
const createUser = vi.fn()
const createAccount = vi.fn()
const sendVerificationEmail = vi.fn()
const userUpdate = vi.fn()
const userFindUnique = vi.fn()
const logAudit = vi.fn()

vi.mock("@/lib/auth-server", () => ({
  auth: {
    $context: Promise.resolve({
      password: { hash: (p: string) => hash(p) },
      internalAdapter: {
        createUser: (d: unknown) => createUser(d),
        createAccount: (d: unknown) => createAccount(d),
      },
    }),
    api: { sendVerificationEmail: (d: unknown) => sendVerificationEmail(d) },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      get update() { return userUpdate },
      get findUnique() { return userFindUnique },
    },
  },
}))
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { adminCreateUser } from "@/lib/actions/admin/users"

const VALID = {
  name: "Vick",
  email: "vick.kumar19@gmail.com",
  password: "correct-horse",
  role: "admin",
} as const

beforeEach(() => {
  vi.clearAllMocks()
  hash.mockResolvedValue("hashed::correct-horse")
  createUser.mockResolvedValue({ id: "user-1" })
  createAccount.mockResolvedValue({})
  sendVerificationEmail.mockResolvedValue({})
  userFindUnique.mockResolvedValue(null)
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
  it("writes a real hashed credential account", async () => {
    await adminCreateUser({ ...VALID })
    expect(hash).toHaveBeenCalledWith("correct-horse")
    expect(
      createAccount,
      "without a credential Account the user cannot sign in at all",
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        providerId: "credential",
        password: "hashed::correct-horse",
      }),
    )
  })

  it("lowercases the email so auth lookups can find the account", async () => {
    await adminCreateUser({ ...VALID, email: "  Vick.Kumar19@Gmail.com  " })
    expect(
      createUser.mock.calls[0][0].email,
      "a mixed-case address is invisible to every better-auth lookup",
    ).toBe("vick.kumar19@gmail.com")
  })

  it("applies the requested role, which better-auth's adapter drops", async () => {
    const result = await adminCreateUser({ ...VALID })
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "user-1" }, data: { role: "admin" } }),
    )
    expect(result.role).toBe("admin")
  })

  it.each(["facility", "vendor", "admin"] as const)(
    "sends the verification email for role %s",
    async (role) => {
      await adminCreateUser({ ...VALID, email: `${role}@example.com`, role })
      expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
    },
  )

  it("does NOT create a session for the new user", async () => {
    // signUpEmail would; that risks swapping the admin's own cookie the
    // moment `nextCookies()` is added. The internal-context path must not.
    await adminCreateUser({ ...VALID })
    const touched = JSON.stringify([
      createUser.mock.calls,
      createAccount.mock.calls,
    ])
    expect(touched.toLowerCase()).not.toContain("session")
  })

  it("still returns the user when the verification email fails", async () => {
    // The account is complete before the send. A mail outage must not fail
    // the action and strand a user that then blocks retry with
    // "already exists".
    sendVerificationEmail.mockRejectedValueOnce(new Error("Resend down"))
    const result = await adminCreateUser({ ...VALID })
    expect(result.id).toBe("user-1")
    expect(userUpdate, "role must still have been applied").toHaveBeenCalled()
  })

  it("sends the email only AFTER the credential exists", async () => {
    const order: string[] = []
    createAccount.mockImplementationOnce(async () => { order.push("account") })
    sendVerificationEmail.mockImplementationOnce(async () => { order.push("email") })
    await adminCreateUser({ ...VALID })
    expect(order).toEqual(["account", "email"])
  })

  it("rejects a duplicate before touching better-auth", async () => {
    userFindUnique.mockResolvedValueOnce({ id: "existing" })
    await expect(adminCreateUser({ ...VALID })).rejects.toThrow(/already exists/i)
    expect(createUser).not.toHaveBeenCalled()
  })
})
