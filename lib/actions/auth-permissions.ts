"use server"

import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import {
  can,
  type AccessContext,
  type AccessSide,
  type AccessTier,
  type Permission,
} from "@/lib/auth/permissions"
import { AccessDeniedError } from "@/lib/auth/access-error"

/**
 * Session-aware access-tier gates (Settings/Users feature).
 *
 * Resolves the caller's `Member.accessTier` and routes every gate through
 * the pure `can()` matrix in `lib/auth/permissions.ts`. Mutating actions
 * add a one-line `await requireCanMutate()`; Settings writes add
 * `await requireCan("settings.manage")`. These THROW (they do not
 * redirect) so server-action error boundaries surface the reason —
 * mirroring `assertCallerCanManage` in `settings.ts`.
 *
 * `"use server"` files may only export async functions — every export
 * here is async on purpose.
 */

/**
 * Resolve the calling user's access context (tier + side). Admin platform
 * users and any user without a Member row resolve to `super` (they manage
 * the platform / their own org), so existing behavior is unchanged until a
 * member is explicitly demoted. Returns `null` only when unauthenticated.
 */
export async function getCurrentAccessContext(): Promise<AccessContext | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  const [member, user] = await Promise.all([
    prisma.member.findFirst({
      where: { userId: session.user.id },
      select: { accessTier: true },
    }),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
  ])

  const side: AccessSide = user?.role === "vendor" ? "vendor" : "facility"
  const tier: AccessTier = member?.accessTier ?? "super"
  return { tier, side }
}

/**
 * Throws `AccessDeniedError` unless the caller may perform `perm`.
 * Unauthenticated callers also throw (the page-level `require*` gate is the
 * redirect layer; this is the action-level capability layer).
 */
export async function requireCan(perm: Permission): Promise<AccessContext> {
  const ctx = await getCurrentAccessContext()
  if (!ctx) throw new AccessDeniedError("Not authenticated")
  if (!can(perm, ctx)) {
    throw new AccessDeniedError(messageFor(perm))
  }
  return ctx
}

/**
 * The one-line read-only gate at the top of every mutating action.
 * Read-only (`user`) tier callers throw here before any write runs.
 */
export async function requireCanMutate(): Promise<AccessContext> {
  return requireCan("mutate")
}

function messageFor(perm: Permission): string {
  switch (perm) {
    case "settings.view":
    case "settings.manage":
      return "Settings access requires a Super User"
    case "members.manage":
      return "Managing members requires a Super User"
    case "mutate":
      return "Your access is read-only"
    default:
      return "Not authorized"
  }
}
