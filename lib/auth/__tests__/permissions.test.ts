import { describe, it, expect } from "vitest"
import {
  can,
  canMutate,
  canManageSettings,
  ACCESS_TIERS,
  type AccessContext,
  type Permission,
} from "@/lib/auth/permissions"

const ctx = (tier: AccessContext["tier"]): AccessContext => ({ tier, side: "vendor" })

describe("access-tier permission matrix", () => {
  it("super can do everything", () => {
    const perms: Permission[] = ["settings.view", "settings.manage", "members.manage", "mutate"]
    for (const p of perms) expect(can(p, ctx("super"))).toBe(true)
  })

  it("advanced can mutate but NOT touch settings or members", () => {
    expect(can("mutate", ctx("advanced"))).toBe(true)
    expect(can("settings.view", ctx("advanced"))).toBe(false)
    expect(can("settings.manage", ctx("advanced"))).toBe(false)
    expect(can("members.manage", ctx("advanced"))).toBe(false)
  })

  it("user (read-only) can do NOTHING mutating", () => {
    const perms: Permission[] = ["settings.view", "settings.manage", "members.manage", "mutate"]
    for (const p of perms) expect(can(p, ctx("user"))).toBe(false)
  })

  it("only super can mutate AND manage settings", () => {
    expect(canMutate("super")).toBe(true)
    expect(canMutate("advanced")).toBe(true)
    expect(canMutate("user")).toBe(false)

    expect(canManageSettings("super")).toBe(true)
    expect(canManageSettings("advanced")).toBe(false)
    expect(canManageSettings("user")).toBe(false)
  })

  it("nesting holds: super ⊇ advanced ⊇ user for every permission", () => {
    const perms: Permission[] = ["settings.view", "settings.manage", "members.manage", "mutate"]
    for (const p of perms) {
      const s = can(p, ctx("super"))
      const a = can(p, ctx("advanced"))
      const u = can(p, ctx("user"))
      // if advanced has it, super must; if user has it, advanced must.
      if (a) expect(s).toBe(true)
      if (u) expect(a).toBe(true)
    }
  })

  it("exposes exactly the three tiers", () => {
    expect([...ACCESS_TIERS]).toEqual(["super", "advanced", "user"])
  })
})
