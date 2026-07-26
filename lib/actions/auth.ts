"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import { rateLimit } from "@/lib/rate-limit"
import { clientIp } from "@/lib/actions/request-ip"
import type { UserRole } from "@/lib/generated/prisma/client"
import { roleConfig } from "@/lib/constants"

// ─── Session Guards ──────────────────────────────────────────────

export async function requireAuth() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect("/login")
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
    redirect(roleConfig[userRole].defaultRedirect)
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
    redirect("/login")
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
    redirect("/login")
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
