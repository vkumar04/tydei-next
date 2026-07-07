import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Access-tier permission-gate coverage for the REAL
 * `lib/actions/auth-permissions.ts`. We mock only the session + DB
 * boundary (`@/lib/auth-server`, `@/lib/db`, `next/headers`) and exercise
 * the real `can()` matrix (`lib/auth/permissions.ts`) and the real
 * `AccessDeniedError` (`lib/auth/access-error.ts`).
 *
 * Covered:
 *   - getCurrentAccessContext: unauthenticated → null; tier resolved from
 *     Member.accessTier; defaults to `super` when no member row; side
 *     inferred from User.role (`vendor` → vendor, else facility).
 *   - requireCan(perm): per-tier pass/throw matrix + the surface-specific
 *     AccessDeniedError messages + the unauthenticated throw.
 *   - requireCanMutate(): super/advanced pass, user throws.
 */

import type { AccessTier } from "@/lib/auth/permissions"

const { authGetSessionMock, memberFindFirstMock, userFindUniqueMock } =
  vi.hoisted(() => ({
    authGetSessionMock: vi.fn(),
    memberFindFirstMock: vi.fn(),
    userFindUniqueMock: vi.fn(),
  }))

// tests/setup.ts globally stubs the access-tier gates so the ~100 action
// tests don't need to mock the session boundary. THIS suite tests the REAL
// gate logic, so undo that global mock for this file (vi.unmock is hoisted
// and, per the Vitest docs, is meant for unmocking modules defined in
// setupFiles). Our static imports below then resolve to the real module.
vi.unmock("@/lib/actions/auth-permissions")

vi.mock("@/lib/db", () => ({
  prisma: {
    member: { findFirst: memberFindFirstMock },
    user: { findUnique: userFindUniqueMock },
  },
}))

vi.mock("@/lib/auth-server", () => ({
  auth: { api: { getSession: authGetSessionMock } },
}))

vi.mock("next/headers", () => ({ headers: async () => new Headers() }))

import {
  getCurrentAccessContext,
  requireCan,
  requireCanMutate,
} from "@/lib/actions/auth-permissions"
import { AccessDeniedError } from "@/lib/auth/access-error"
import type { Permission } from "@/lib/auth/permissions"

/**
 * Stub the session + DB lookups so getCurrentAccessContext resolves to the
 * given tier/role. `accessTier: null` simulates "no member row" (defaults
 * to super); `role` drives the `side` inference.
 */
function asTier(
  tier: AccessTier | null,
  role: "facility" | "vendor" | "admin" = "facility",
): void {
  authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
  memberFindFirstMock.mockResolvedValue(
    tier === null ? null : { accessTier: tier },
  )
  userFindUniqueMock.mockResolvedValue({ role })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getCurrentAccessContext", () => {
  it("returns null when unauthenticated (getSession → null)", async () => {
    authGetSessionMock.mockResolvedValue(null)

    await expect(getCurrentAccessContext()).resolves.toBeNull()
    expect(memberFindFirstMock).not.toHaveBeenCalled()
    expect(userFindUniqueMock).not.toHaveBeenCalled()
  })

  it("resolves tier from the member's accessTier", async () => {
    asTier("advanced", "facility")

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "advanced",
      side: "facility",
    })
  })

  it("FAIL-SECURE: a non-admin user with NO member row falls to read-only `user`", async () => {
    asTier(null, "facility")

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "user",
      side: "facility",
    })
  })

  it("a platform admin (role=admin) with NO member row stays `super`", async () => {
    asTier(null, "admin")

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "super",
      side: "facility",
    })
  })

  it("FAIL-SECURE: a vendor user with NO member row falls to read-only `user`", async () => {
    asTier(null, "vendor")

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "user",
      side: "vendor",
    })
  })

  it("infers side `vendor` when user.role === 'vendor'", async () => {
    asTier("user", "vendor")

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "user",
      side: "vendor",
    })
  })

  it("infers side `facility` for non-vendor roles (admin)", async () => {
    asTier("super", "admin")

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "super",
      side: "facility",
    })
  })

  it("infers side `facility` when the user row is missing", async () => {
    authGetSessionMock.mockResolvedValue({ user: { id: "u-1" } })
    memberFindFirstMock.mockResolvedValue({ accessTier: "super" })
    userFindUniqueMock.mockResolvedValue(null)

    await expect(getCurrentAccessContext()).resolves.toEqual({
      tier: "super",
      side: "facility",
    })
  })
})

describe("requireCan", () => {
  const ALL_PERMS: Permission[] = [
    "settings.view",
    "settings.manage",
    "members.manage",
    "mutate",
  ]

  it("super → every permission passes and returns the context", async () => {
    for (const perm of ALL_PERMS) {
      vi.clearAllMocks()
      asTier("super", "facility")
      await expect(requireCan(perm)).resolves.toEqual({
        tier: "super",
        side: "facility",
      })
    }
  })

  it("advanced → mutate passes; settings/members throw AccessDeniedError", async () => {
    asTier("advanced", "facility")
    await expect(requireCan("mutate")).resolves.toEqual({
      tier: "advanced",
      side: "facility",
    })

    for (const perm of [
      "settings.view",
      "settings.manage",
      "members.manage",
    ] as Permission[]) {
      vi.clearAllMocks()
      asTier("advanced", "facility")
      await expect(requireCan(perm)).rejects.toBeInstanceOf(AccessDeniedError)
    }
  })

  it("user → every permission throws AccessDeniedError", async () => {
    for (const perm of ALL_PERMS) {
      vi.clearAllMocks()
      asTier("user", "facility")
      await expect(requireCan(perm)).rejects.toBeInstanceOf(AccessDeniedError)
    }
  })

  it("throws the settings-surface message for settings.view / settings.manage", async () => {
    for (const perm of ["settings.view", "settings.manage"] as Permission[]) {
      vi.clearAllMocks()
      asTier("user", "facility")
      await expect(requireCan(perm)).rejects.toThrow(
        /Settings access requires a Super User/,
      )
    }
  })

  it("throws the members-surface message for members.manage", async () => {
    asTier("user", "facility")
    await expect(requireCan("members.manage")).rejects.toThrow(
      /Managing members requires a Super User/,
    )
  })

  it("throws the read-only message for mutate", async () => {
    asTier("user", "facility")
    await expect(requireCan("mutate")).rejects.toThrow(
      /Your access is read-only/,
    )
  })

  it("throws 'Not authenticated' when unauthenticated", async () => {
    authGetSessionMock.mockResolvedValue(null)
    await expect(requireCan("mutate")).rejects.toThrow(/Not authenticated/)
    await expect(requireCan("mutate")).rejects.toBeInstanceOf(AccessDeniedError)
  })
})

describe("requireCanMutate", () => {
  it("passes for super", async () => {
    asTier("super", "facility")
    await expect(requireCanMutate()).resolves.toEqual({
      tier: "super",
      side: "facility",
    })
  })

  it("passes for advanced", async () => {
    asTier("advanced", "vendor")
    await expect(requireCanMutate()).resolves.toEqual({
      tier: "advanced",
      side: "vendor",
    })
  })

  it("throws AccessDeniedError (read-only) for user", async () => {
    asTier("user", "facility")
    await expect(requireCanMutate()).rejects.toBeInstanceOf(AccessDeniedError)
    await expect(requireCanMutate()).rejects.toThrow(/Your access is read-only/)
  })
})
