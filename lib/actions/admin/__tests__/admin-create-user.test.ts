import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * `adminCreateUser` — invite-based onboarding.
 *
 * History, because it explains every assertion here:
 *
 *  1. Originally `prisma.user.create({ ...userData, emailVerified: true })`
 *     with the password destructured away. No credential, no email, and the
 *     address stored verbatim — and better-auth lowercases before an exact
 *     match, so a mixed-case row was invisible to sign-in AND to password
 *     reset, which fails silently by design.
 *  2. The first fix routed through `auth.api.signUpEmail`, which sends the
 *     verification mail INSIDE the call and AFTER the user row commits. A mail
 *     failure threw out of a half-finished create: user exists, role never
 *     applied, retry blocked by "already exists". It also created a Session
 *     for the new user.
 *  3. Now: no password at all. The admin never chooses someone else's
 *     credential; the account is created without one and an invite carries a
 *     set-password link. The Access step's selections finally persist as
 *     Member + FacilityAssignment rows — before this they were collected in
 *     the UI and thrown away, exactly like the password.
 */

const createUser = vi.fn()
const createVerificationValue = vi.fn()
const userUpdate = vi.fn()
const userFindUnique = vi.fn()
const facilityFindMany = vi.fn()
const vendorFindMany = vi.fn()
const memberCreateMany = vi.fn()
const assignmentCreateMany = vi.fn()
const sendEmail = vi.fn()
const accountInviteEmail = vi.fn()
const logAudit = vi.fn()

vi.mock("@/lib/auth-server", () => ({
  auth: {
    api: {},
    $context: Promise.resolve({
      password: { hash: vi.fn() },
      internalAdapter: {
        createUser: (d: unknown) => createUser(d),
        createAccount: vi.fn(),
        createVerificationValue: (d: unknown) => createVerificationValue(d),
      },
    }),
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi
    .fn()
    .mockResolvedValue({ user: { id: "admin-1", name: "Admin Demo" } }),
}))
vi.mock("@/lib/db", () => {
  const tx = {
    user: { update: (d: unknown) => userUpdate(d) },
    member: { createMany: (d: unknown) => memberCreateMany(d) },
    facilityAssignment: { createMany: (d: unknown) => assignmentCreateMany(d) },
  }
  return {
    prisma: {
      user: {
        get findUnique() { return userFindUnique },
        get update() { return userUpdate },
      },
      facility: { get findMany() { return facilityFindMany } },
      vendor: { get findMany() { return vendorFindMany } },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    },
  }
})
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))
vi.mock("@/lib/email", () => ({ sendEmail: (d: unknown) => sendEmail(d) }))
vi.mock("@/lib/emails/render", () => ({
  accountInviteEmail: (p: unknown) => {
    accountInviteEmail(p)
    return Promise.resolve({ subject: "s", html: "h", text: "t" })
  },
}))
vi.mock("@/lib/site-url", () => ({ appUrl: "https://tydei.com" }))

import { adminCreateUser } from "@/lib/actions/admin/users"

const FACILITY_USER: Parameters<typeof adminCreateUser>[0] = {
  name: "Vick",
  email: "vick.kumar19@gmail.com",
  role: "facility",
  facilityIds: ["fac-1", "fac-2"],
  vendorIds: [],
}

beforeEach(() => {
  vi.clearAllMocks()
  createUser.mockResolvedValue({ id: "user-1" })
  createVerificationValue.mockResolvedValue({})
  userFindUnique.mockResolvedValue(null)
  memberCreateMany.mockResolvedValue({})
  assignmentCreateMany.mockResolvedValue({})
  sendEmail.mockResolvedValue({})
  facilityFindMany.mockResolvedValue([
    { id: "fac-1", name: "Lighthouse Surgical Center", organizationId: "org-1" },
    { id: "fac-2", name: "Summit General", organizationId: "org-1" },
  ])
  vendorFindMany.mockResolvedValue([
    { id: "ven-1", name: "Stryker", organizationId: "org-9" },
  ])
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

describe("no password is ever set by the admin", () => {
  it("creates the user without a credential account", async () => {
    await adminCreateUser({ ...FACILITY_USER })
    const ctx = await (
      await import("@/lib/auth-server")
    ).auth.$context as unknown as { internalAdapter: { createAccount: ReturnType<typeof vi.fn> } }
    expect(
      ctx.internalAdapter.createAccount,
      "the invite link is what mints the credential, not the admin",
    ).not.toHaveBeenCalled()
  })

  it("mints a set-password token and emails a link that carries it", async () => {
    await adminCreateUser({ ...FACILITY_USER })
    const identifier = createVerificationValue.mock.calls[0][0].identifier as string
    // better-auth's own reset record, so its existing endpoint consumes it and
    // creates the missing credential on first use.
    expect(identifier.startsWith("reset-password:")).toBe(true)
    const token = identifier.split(":")[1]

    const url = accountInviteEmail.mock.calls[0][0].url as string
    expect(url).toContain(`token=${token}`)
    // Only changes the page copy to "Set your password".
    expect(url).toContain("invite=1")
    expect(sendEmail).toHaveBeenCalledTimes(1)
  })

  it("marks the address verified so the invite isn't a dead end", async () => {
    // requireEmailVerification blocks sign-in, and better-auth's resetPassword
    // does NOT set emailVerified — so an unverified invitee would set a
    // password and still be locked out.
    await adminCreateUser({ ...FACILITY_USER })
    expect(createUser.mock.calls[0][0].emailVerified).toBe(true)
  })
})

describe("the Access step actually grants access", () => {
  it("writes Member rows for the selected organizations", async () => {
    await adminCreateUser({ ...FACILITY_USER })
    expect(
      memberCreateMany,
      "without a Member row requireFacility finds no org and the account " +
        "cannot load a portal at all",
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ organizationId: "org-1", userId: "user-1", role: "member" }],
      }),
    )
  })

  it("writes a FacilityAssignment per selected facility", async () => {
    await adminCreateUser({ ...FACILITY_USER })
    expect(assignmentCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { userId: "user-1", facilityId: "fac-1" },
          { userId: "user-1", facilityId: "fac-2" },
        ],
      }),
    )
  })

  it("uses vendor organizations for a vendor user", async () => {
    await adminCreateUser({
      name: "Rep",
      email: "rep@stryker.com",
      role: "vendor",
      facilityIds: [],
      vendorIds: ["ven-1"],
    })
    expect(memberCreateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ organizationId: "org-9", userId: "user-1", role: "member" }],
      }),
    )
    // Facility assignments are a facility-side concept only.
    expect(assignmentCreateMany).not.toHaveBeenCalled()
  })

  it("grants nothing for a platform admin", async () => {
    await adminCreateUser({
      name: "Op",
      email: "op@tydei.com",
      role: "admin",
      facilityIds: [],
      vendorIds: [],
    })
    expect(memberCreateMany).not.toHaveBeenCalled()
    expect(assignmentCreateMany).not.toHaveBeenCalled()
    expect(sendEmail, "admins still get invited").toHaveBeenCalledTimes(1)
  })

  it("refuses an organization-less facility rather than making a dead account", async () => {
    facilityFindMany.mockResolvedValueOnce([
      { id: "fac-1", name: "Orphan Clinic", organizationId: null },
    ])
    await expect(
      adminCreateUser({ ...FACILITY_USER, facilityIds: ["fac-1"] }),
    ).rejects.toThrow(/no organization yet/i)
    expect(createUser, "nothing should be written").not.toHaveBeenCalled()
  })

  it("rejects an unknown id instead of silently granting less", async () => {
    facilityFindMany.mockResolvedValueOnce([
      { id: "fac-1", name: "Lighthouse", organizationId: "org-1" },
    ])
    await expect(
      adminCreateUser({ ...FACILITY_USER, facilityIds: ["fac-1", "nope"] }),
    ).rejects.toThrow(/unknown facility: nope/i)
  })
})

describe("carried over from earlier fixes", () => {
  it("lowercases the email so auth lookups can find the account", async () => {
    await adminCreateUser({ ...FACILITY_USER, email: "  Vick.Kumar19@Gmail.com  " })
    expect(createUser.mock.calls[0][0].email).toBe("vick.kumar19@gmail.com")
  })

  it("applies the role, which better-auth's adapter drops", async () => {
    const r = await adminCreateUser({ ...FACILITY_USER })
    expect(r.role).toBe("facility")
  })

  it("still returns the user when the invite email fails", async () => {
    sendEmail.mockRejectedValueOnce(new Error("Resend down"))
    const r = await adminCreateUser({ ...FACILITY_USER })
    expect(r.id).toBe("user-1")
    expect(memberCreateMany, "access must still be granted").toHaveBeenCalled()
  })

  it("rejects a duplicate before writing anything", async () => {
    userFindUnique.mockResolvedValueOnce({ id: "existing" })
    await expect(adminCreateUser({ ...FACILITY_USER })).rejects.toThrow(
      /already exists/i,
    )
    expect(createUser).not.toHaveBeenCalled()
  })
})
