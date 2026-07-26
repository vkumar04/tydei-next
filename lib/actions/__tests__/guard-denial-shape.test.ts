import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * A denied guard must REDIRECT during a render and THROW inside a Server
 * Action (audit 2026-07-26).
 *
 * Why the split matters: per the Next docs a `redirect()` from a Server Action
 * "navigates the router". Server Actions are also how this app does its client
 * data reads (TanStack Query calls them directly), so a background poll that
 * fails its guard doesn't show an error — it YANKS THE USER OFF THE PAGE,
 * seconds after it rendered, with nothing to explain it. That is exactly how
 * the notification-bell bug presented: an operator clicked Users, landed, and
 * got thrown back to the dashboard by a poll they never saw.
 *
 * During a render, redirect() is still correct and stays.
 *
 * The two are told apart by the `Next-Action` header the client dispatcher
 * sets on every Server Action POST — verified against a running dev server as
 * present on 11/11 action calls and absent on 17/17 renders.
 *
 * This only picks the SHAPE of a denial. Access is refused either way, so a
 * wrong answer can never grant access.
 */

const redirect = vi.fn((url: string) => {
  // Mirror the real thing: redirect() throws a control-flow exception.
  const err = new Error(`NEXT_REDIRECT:${url}`)
  err.name = "NEXT_REDIRECT"
  throw err
})
const getSession = vi.fn()
const userFindUnique = vi.fn()
const headerStore = { value: new Map<string, string>() }

vi.mock("next/headers", () => ({
  headers: async () => ({
    has: (k: string) => headerStore.value.has(k.toLowerCase()),
    get: (k: string) => headerStore.value.get(k.toLowerCase()) ?? null,
  }),
}))
vi.mock("next/navigation", () => ({ redirect: (u: string) => redirect(u) }))
vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: () => getSession() } },
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { get findUnique() { return userFindUnique } },
    member: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}))
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ success: true }) }))
vi.mock("@/lib/actions/request-ip", () => ({ clientIp: async () => "1.1.1.1" }))

import { requireAuth, requireRole } from "@/lib/actions/auth"
import { isAccessDenied } from "@/lib/auth/access-denied"

function asRender() {
  headerStore.value = new Map()
}
function asServerAction() {
  headerStore.value = new Map([["next-action", "40abc123"]])
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: "u1" } })
  userFindUnique.mockResolvedValue({ role: "facility" })
})

describe("denial during a page render", () => {
  it("requireAuth redirects to /login when signed out", async () => {
    asRender()
    getSession.mockResolvedValueOnce(null)
    await expect(requireAuth()).rejects.toThrow(/NEXT_REDIRECT:\/login/)
    expect(redirect).toHaveBeenCalledWith("/login")
  })

  it("requireRole redirects a mismatched role to its own portal", async () => {
    asRender()
    userFindUnique.mockResolvedValueOnce({ role: "facility" })
    await expect(requireRole("admin")).rejects.toThrow(/NEXT_REDIRECT/)
    // A facility user asking for admin lands on the facility dashboard.
    expect(redirect).toHaveBeenCalledWith("/dashboard")
  })
})

describe("denial inside a Server Action", () => {
  it("requireAuth throws instead of navigating", async () => {
    asServerAction()
    getSession.mockResolvedValueOnce(null)
    await expect(requireAuth()).rejects.toSatisfy(isAccessDenied)
    expect(
      redirect,
      "a redirect here would navigate the router out from under the user",
    ).not.toHaveBeenCalled()
  })

  it("requireRole throws instead of navigating", async () => {
    asServerAction()
    userFindUnique.mockResolvedValueOnce({ role: "facility" })
    await expect(requireRole("admin")).rejects.toSatisfy(isAccessDenied)
    expect(redirect).not.toHaveBeenCalled()
  })

  it("the thrown error carries something a UI can show", async () => {
    asServerAction()
    userFindUnique.mockResolvedValueOnce({ role: "vendor" })
    await expect(requireRole("admin")).rejects.toThrow(/don't have access/i)
  })
})

describe("the happy path is untouched", () => {
  it.each([["render", asRender], ["server action", asServerAction]])(
    "a matching role passes through during a %s",
    async (_label, setup) => {
      setup()
      userFindUnique.mockResolvedValueOnce({ role: "admin" })
      await expect(requireRole("admin")).resolves.toMatchObject({
        user: { id: "u1" },
      })
      expect(redirect).not.toHaveBeenCalled()
    },
  )
})
