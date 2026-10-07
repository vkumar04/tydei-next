import { describe, expect, it, vi, beforeEach } from "vitest"
import { AccessDeniedError } from "@/lib/auth/access-error"

const { userFindUnique, memberFindFirst, requireCanMutate } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  memberFindFirst: vi.fn(),
  requireCanMutate: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    member: { findFirst: memberFindFirst },
  },
}))

vi.mock("@/lib/actions/auth-permissions", () => ({ requireCanMutate }))

import { denyUnlessPortalWriter } from "@/lib/api/import-route-auth"

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue({ role: "facility" })
  memberFindFirst.mockResolvedValue({ id: "member-1" })
  requireCanMutate.mockResolvedValue({ tier: "super", side: "facility" })
})

async function expectDenied(res: Response | null, error: string) {
  expect(res).not.toBeNull()
  expect(res!.status).toBe(403)
  expect(await res!.json()).toEqual({ error })
}

describe("denyUnlessPortalWriter", () => {
  it("allows a facility writer whose org links to a facility", async () => {
    expect(await denyUnlessPortalWriter("u-1", "facility")).toBeNull()
    expect(userFindUnique).toHaveBeenCalledWith({ where: { id: "u-1" }, select: { role: true } })
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { userId: "u-1", organization: { facility: { isNot: null } } },
      select: { id: true },
    })
    expect(requireCanMutate).toHaveBeenCalledTimes(1)
  })

  it("allows a vendor writer and scopes the member lookup to vendor orgs", async () => {
    userFindUnique.mockResolvedValue({ role: "vendor" })
    expect(await denyUnlessPortalWriter("u-2", "vendor")).toBeNull()
    expect(memberFindFirst).toHaveBeenCalledWith({
      where: { userId: "u-2", organization: { vendor: { isNot: null } } },
      select: { id: true },
    })
  })

  it("returns 403 for a vendor-role user hitting a facility upload, before any member or tier lookup", async () => {
    userFindUnique.mockResolvedValue({ role: "vendor" })
    await expectDenied(await denyUnlessPortalWriter("u-3", "facility"), "Not authorized")
    expect(memberFindFirst).not.toHaveBeenCalled()
    expect(requireCanMutate).not.toHaveBeenCalled()
  })

  it("returns 403 for a facility-role user hitting a vendor upload", async () => {
    await expectDenied(await denyUnlessPortalWriter("u-4", "vendor"), "Not authorized")
    expect(memberFindFirst).not.toHaveBeenCalled()
  })

  it("returns 403 for an admin on either portal", async () => {
    userFindUnique.mockResolvedValue({ role: "admin" })
    await expectDenied(await denyUnlessPortalWriter("u-5", "facility"), "Not authorized")
    await expectDenied(await denyUnlessPortalWriter("u-5", "vendor"), "Not authorized")
  })

  it("returns 403 when the user row does not exist", async () => {
    userFindUnique.mockResolvedValue(null)
    await expectDenied(await denyUnlessPortalWriter("ghost", "facility"), "Not authorized")
    expect(memberFindFirst).not.toHaveBeenCalled()
  })

  it("returns 403 for a tenantless facility-role user with no facility-linked membership", async () => {
    memberFindFirst.mockResolvedValue(null)
    await expectDenied(await denyUnlessPortalWriter("u-6", "facility"), "Not authorized")
    expect(requireCanMutate).not.toHaveBeenCalled()
  })

  it("returns 403 for a vendor-role user whose org has no vendor link", async () => {
    userFindUnique.mockResolvedValue({ role: "vendor" })
    memberFindFirst.mockResolvedValue(null)
    await expectDenied(await denyUnlessPortalWriter("u-7", "vendor"), "Not authorized")
  })

  it("returns 403 'Your access is read-only' when the write-tier gate denies", async () => {
    requireCanMutate.mockRejectedValue(new AccessDeniedError("Read-only users cannot make changes"))
    await expectDenied(await denyUnlessPortalWriter("u-8", "facility"), "Your access is read-only")
  })

  it("propagates a non-access failure from the write-tier gate instead of masking it as 403", async () => {
    requireCanMutate.mockRejectedValue(new Error("database unavailable"))
    await expect(denyUnlessPortalWriter("u-9", "facility")).rejects.toThrow("database unavailable")
  })

  it("propagates a failing user lookup", async () => {
    userFindUnique.mockRejectedValue(new Error("pool exhausted"))
    await expect(denyUnlessPortalWriter("u-10", "vendor")).rejects.toThrow("pool exhausted")
  })
})
