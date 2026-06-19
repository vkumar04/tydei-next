import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Session/role auth-gate coverage for the REAL `lib/actions/auth.ts`:
 * `requireAuth`, `requireRole`, `requireFacility`, `requireVendor`,
 * `requireAdmin`.
 *
 * `redirect` (next/navigation) is mocked as a vi.fn that THROWS a tagged
 * `REDIRECT:<url>` sentinel — mirroring Next's real never-returning
 * redirect — so we can assert both the throw AND the exact target path.
 * We mock only the boundary (`@/lib/auth-server`, `@/lib/db`,
 * `next/headers`, `next/navigation`) and use the real `roleConfig`.
 */

const {
  authGetSessionMock,
  userFindUniqueMock,
  memberFindFirstMock,
  redirectMock,
} = vi.hoisted(() => ({
  authGetSessionMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  memberFindFirstMock: vi.fn(),
  redirectMock: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`)
  }),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: userFindUniqueMock },
    member: { findFirst: memberFindFirstMock },
  },
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: authGetSessionMock } },
}))

vi.mock("next/headers", () => ({ headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ redirect: redirectMock }))

import {
  requireAuth,
  requireRole,
  requireFacility,
  requireVendor,
  requireAdmin,
} from "@/lib/actions/auth"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("requireAuth", () => {
  it("redirects to /login when there is no session", async () => {
    authGetSessionMock.mockResolvedValue(null)

    await expect(requireAuth()).rejects.toThrow("REDIRECT:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })

  it("returns the session when authenticated", async () => {
    const session = { user: { id: "u-1", email: "f@example.com" } }
    authGetSessionMock.mockResolvedValue(session)

    await expect(requireAuth()).resolves.toBe(session)
    expect(redirectMock).not.toHaveBeenCalled()
  })
})

describe("requireRole", () => {
  it("returns the session when the user's role matches", async () => {
    const session = { user: { id: "u-1" } }
    authGetSessionMock.mockResolvedValue(session)
    userFindUniqueMock.mockResolvedValue({ role: "facility" })

    await expect(requireRole("facility")).resolves.toBe(session)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects to the user's role default when the role does NOT match", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    // user is a vendor but the gate requires facility
    userFindUniqueMock.mockResolvedValue({ role: "vendor" })

    await expect(requireRole("facility")).rejects.toThrow(
      "REDIRECT:/vendor/dashboard",
    )
    expect(redirectMock).toHaveBeenCalledWith("/vendor/dashboard")
  })

  it("redirects to the admin default when the matched role is admin", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    userFindUniqueMock.mockResolvedValue({ role: "admin" })

    await expect(requireRole("facility")).rejects.toThrow(
      "REDIRECT:/admin/dashboard",
    )
    expect(redirectMock).toHaveBeenCalledWith("/admin/dashboard")
  })

  it("falls back to the facility default redirect when the user row is missing", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    userFindUniqueMock.mockResolvedValue(null)

    await expect(requireRole("vendor")).rejects.toThrow("REDIRECT:/dashboard")
    expect(redirectMock).toHaveBeenCalledWith("/dashboard")
  })

  it("redirects to /login (via requireAuth) when unauthenticated", async () => {
    authGetSessionMock.mockResolvedValue(null)

    await expect(requireRole("facility")).rejects.toThrow("REDIRECT:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })
})

describe("requireFacility", () => {
  it("returns { ...session, facility } on success", async () => {
    const session = { user: { id: "u-1", email: "f@example.com" } }
    authGetSessionMock.mockResolvedValue(session)
    userFindUniqueMock.mockResolvedValue({ role: "facility" })
    const facility = { id: "fac-1", name: "Lighthouse Surgical Center" }
    memberFindFirstMock.mockResolvedValue({
      organization: { facility },
    })

    const result = await requireFacility()
    expect(result).toEqual({ ...session, facility })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects to /login when the member has no facility", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    userFindUniqueMock.mockResolvedValue({ role: "facility" })
    memberFindFirstMock.mockResolvedValue({
      organization: { facility: null },
    })

    await expect(requireFacility()).rejects.toThrow("REDIRECT:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })

  it("redirects to /login when there is no member row", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    userFindUniqueMock.mockResolvedValue({ role: "facility" })
    memberFindFirstMock.mockResolvedValue(null)

    await expect(requireFacility()).rejects.toThrow("REDIRECT:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })

  it("redirects (role mismatch) before reaching the facility lookup", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    userFindUniqueMock.mockResolvedValue({ role: "vendor" })

    await expect(requireFacility()).rejects.toThrow(
      "REDIRECT:/vendor/dashboard",
    )
    expect(memberFindFirstMock).not.toHaveBeenCalled()
  })
})

describe("requireVendor", () => {
  it("returns { ...session, vendor } on success", async () => {
    const session = { user: { id: "u-2", email: "v@example.com" } }
    authGetSessionMock.mockResolvedValue(session)
    userFindUniqueMock.mockResolvedValue({ role: "vendor" })
    const vendor = { id: "vendor-1", name: "Medtronic" }
    memberFindFirstMock.mockResolvedValue({
      organization: { vendor },
    })

    const result = await requireVendor()
    expect(result).toEqual({ ...session, vendor })
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects to /login when the member has no vendor", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-2" } })
    userFindUniqueMock.mockResolvedValue({ role: "vendor" })
    memberFindFirstMock.mockResolvedValue({
      organization: { vendor: null },
    })

    await expect(requireVendor()).rejects.toThrow("REDIRECT:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })

  it("redirects to /login when there is no member row", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-2" } })
    userFindUniqueMock.mockResolvedValue({ role: "vendor" })
    memberFindFirstMock.mockResolvedValue(null)

    await expect(requireVendor()).rejects.toThrow("REDIRECT:/login")
    expect(redirectMock).toHaveBeenCalledWith("/login")
  })

  it("redirects (role mismatch) before reaching the vendor lookup", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-2" } })
    userFindUniqueMock.mockResolvedValue({ role: "facility" })

    await expect(requireVendor()).rejects.toThrow("REDIRECT:/dashboard")
    expect(memberFindFirstMock).not.toHaveBeenCalled()
  })
})

describe("requireAdmin", () => {
  it("returns the session when the user is an admin", async () => {
    const session = { user: { id: "u-3" } }
    authGetSessionMock.mockResolvedValue(session)
    userFindUniqueMock.mockResolvedValue({ role: "admin" })

    await expect(requireAdmin()).resolves.toBe(session)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it("redirects to the role default when the caller is not an admin", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-3" } })
    userFindUniqueMock.mockResolvedValue({ role: "facility" })

    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/dashboard")
    expect(redirectMock).toHaveBeenCalledWith("/dashboard")
  })
})
