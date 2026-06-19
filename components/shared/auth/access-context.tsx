"use client"

import { createContext, useContext, type ReactNode } from "react"
import {
  can,
  canMutate as canMutateTier,
  type AccessContext,
  type AccessSide,
  type AccessTier,
  type Permission,
} from "@/lib/auth/permissions"

/**
 * Client-side access context (Settings/Users feature). The server resolves
 * the caller's tier (`getCurrentAccessContext`) and passes it into
 * `<AccessProvider>`; client components read it via `useAccessTier()` /
 * `useCan()` to disable or hide mutating affordances.
 *
 * Default tier is `super` when no provider is mounted, so surfaces that
 * haven't been wrapped yet keep full behavior (the SERVER gates are the
 * real enforcement; these are courtesy affordances).
 */

const Ctx = createContext<AccessContext>({ tier: "super", side: "facility" })

export function AccessProvider({
  tier,
  side,
  children,
}: {
  tier: AccessTier
  side: AccessSide
  children: ReactNode
}) {
  return <Ctx.Provider value={{ tier, side }}>{children}</Ctx.Provider>
}

export function useAccessContext(): AccessContext {
  return useContext(Ctx)
}

export function useAccessTier(): AccessTier {
  return useContext(Ctx).tier
}

export function useCan(perm: Permission): boolean {
  return can(perm, useContext(Ctx))
}

export function useCanMutate(): boolean {
  return canMutateTier(useContext(Ctx).tier)
}
