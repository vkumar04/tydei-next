"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/actions/request-ip"
import type { UserRole } from "@/lib/generated/prisma/client"
import { roleConfig } from "@/lib/constants"
// Not declared here: this file is "use server", where every export must be an
// async function (see lib/auth/access-denied.ts).
import { AccessDeniedError } from "@/lib/auth/access-denied"

// ─── Session Guards ──────────────────────────────────────────────

/**
 * Is this a page/layout render, or a Server Action invocation?
 *
 * Denial has to mean different things in the two cases:
 *
 *   render  -> redirect(). Bouncing someone off a page they may not see is
 *              exactly right, and it is how every portal boundary works.
 *   action  -> throw. A Server Action is a data call. Per the Next docs a
 *              redirect from one "navigates the router", so a background
 *              read that happens to fail its guard YANKS THE USER OFF THE
 *              PAGE — seconds after it rendered, with no explanation. That
 *              is precisely how the notification-bell bug presented: an
 *              operator clicked Users, landed, and got thrown back to the
 *              dashboard by a poll they never saw.
 *
 * Detection uses the `Next-Action` header that the client dispatcher sets on
 * every Server Action POST. Verified empirically against a running dev
 * server: present on 11/11 action calls, absent on 17/17 page renders.
 *
 * `forbidden()` from next/navigation is the framework's own answer here, but
 * it needs `experimental.authInterrupts` and the Next docs say plainly it is
 * "not recommended for production" — not a trade worth making on the auth
 * path of a PHI application. Revisit when it stabilises.
 *
 * SECURITY NOTE: this only chooses the SHAPE of a denial. Access is refused
 * either way, so a wrong answer here can never grant access — the worst case
 * is an error where a redirect would have been nicer, or vice versa.
 */
async function denyingARender(): Promise<boolean> {
  return !(await headers()).has("next-action")
}

export async function requireAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    if (await denyingARender()) redirect("/login")
    throw new AccessDeniedError("Your session has expired. Please sign in again.")
  }

  return session
}

export async function requireRole(role: UserRole) {
  const session = await requireAuth()

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })

  if (!user || user.role !== role) {
    const userRole = user?.role ?? "facility"
    if (await denyingARender()) redirect(roleConfig[userRole].defaultRedirect)
    throw new AccessDeniedError(
      "You don't have access to this area. If you think that's wrong, sign " +
        "out and back in.",
    )
  }

  return session
}

export async function requireFacility() {
  const session = await requireRole("facility")

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: { facility: true },
      },
    },
  })

  const facility = member?.organization?.facility
  if (!facility) {
    // Authenticated with the right role but no facility linked — a data
    // problem, not a credentials one. Same render/action split as above.
    if (await denyingARender()) redirect("/login")
    throw new AccessDeniedError(
      "Your account isn't linked to a facility yet. Contact your administrator.",
    )
  }

  return { ...session, facility }
}

export async function requireVendor() {
  const session = await requireRole("vendor")

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: {
      organization: {
        include: { vendor: true },
      },
    },
  })

  const vendor = member?.organization?.vendor
  if (!vendor) {
    // Authenticated with the right role but no vendor linked — a data
    // problem, not a credentials one. Same render/action split as above.
    if (await denyingARender()) redirect("/login")
    throw new AccessDeniedError(
      "Your account isn't linked to a vendor yet. Contact your administrator.",
    )
  }

  return { ...session, vendor }
}

export async function requireAdmin() {
  return requireRole("admin")
}

// ─── Forgot / Reset Password ────────────────────────────────────
//
// These call `auth.api.*` DIRECTLY, which bypasses better-auth's rate
// limiter: `onRequestRateLimit` runs inside better-auth's HTTP handler
// (`api/index.mjs`), and a server action never crosses it. So the
// `customRules["/forget-password"]` cap configured in lib/auth-server.ts
// does NOT protect this path (audit 2026-07-26) — without the explicit
// limiter below, anyone could drive unlimited password-reset mail at any
// address, burning Resend quota and the domain's sending reputation.
//
// Any future server action that reaches auth.api directly on an
// UNAUTHENTICATED path needs the same treatment.

/** Reset requests per IP per minute. */
const RESET_REQUEST_LIMIT = 5
/** Reset-token submissions per IP per minute (token brute-force guard). */
const RESET_SUBMIT_LIMIT = 10
/** Verification re-sends per IP per minute. */
const VERIFY_RESEND_LIMIT = 3
const ONE_MINUTE = 60_000

export async function requestPasswordReset(email: string) {
  const { success } = rateLimit(
    `pwreset:${await clientIp()}`,
    RESET_REQUEST_LIMIT,
    ONE_MINUTE,
  )
  if (!success) {
    // Deliberately the same shape as the success path: the caller must not
    // be able to distinguish "throttled" from "sent", or this becomes an
    // account-existence oracle.
    return
  }
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: "/reset-password" },
  })
}

export async function resetPassword(token: string, newPassword: string) {
  const { success } = rateLimit(
    `pwsubmit:${await clientIp()}`,
    RESET_SUBMIT_LIMIT,
    ONE_MINUTE,
  )
  if (!success) {
    throw new Error("Too many attempts — please wait a minute and try again.")
  }
  await auth.api.resetPassword({
    body: { token, newPassword },
  })
}

/**
 * Re-send the email-verification link.
 *
 * `requireEmailVerification: true` blocks sign-in until the address is
 * verified, and before 2026-07-26 there was NO way to get a fresh link —
 * losing the original email meant a permanently unusable account. The
 * login form calls this when sign-in fails with EMAIL_NOT_VERIFIED.
 *
 * Always resolves regardless of whether the address exists, so it can't be
 * used to enumerate accounts.
 */
export async function resendVerificationEmail(email: string) {
  const { success } = rateLimit(
    `verifyresend:${await clientIp()}`,
    VERIFY_RESEND_LIMIT,
    ONE_MINUTE,
  )
  if (!success) return

  try {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: "/dashboard" },
    })
  } catch (err) {
    // Unknown address / already verified both land here. Log for operators,
    // stay silent to the caller.
    console.error("[resendVerificationEmail]", err)
  }
}
