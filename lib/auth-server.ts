import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { organization } from "better-auth/plugins"
import { stripe } from "@better-auth/stripe"
import Stripe from "stripe"
import { Resend } from "resend"
import { prisma } from "@/lib/db"

// Conditional init: previously these were unconditional `new Stripe(...)` /
// `new Resend(...)` at module-load time, which threw
// `Neither apiKey nor config.authenticator provided` when
// STRIPE_SECRET_KEY was missing — breaking every test file that
// transitively imports lib/auth-server.ts (e.g.
// lib/__tests__/auth-server-org-hooks.test.ts). Now we skip the
// integration entirely when its env var is missing; prod has the var,
// tests don't, and the hook functions exported from this module work
// without either client.
const stripeClient = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null

// ─── Org-plugin defense-in-depth ─────────────────────────────────
//
// These hooks are the platform-wide belt for the suspenders that
// `lib/actions/settings.ts` already wears (role enums + last-admin
// checks). They fire on every better-auth organization API call —
// `auth.api.createInvitation`, `auth.api.acceptInvitation`,
// `auth.api.updateMemberRole`, `auth.api.removeMember` — including
// any future code path that doesn't go through our hand-rolled
// server actions. The Charles audit (commit f41730e) documented the
// three role-escalation BLOCKERs; these hooks ensure the same rules
// apply to the better-auth API surface.
//
// Vendor sub-roles are stored in the `role` field as
// `"<base>:<sub>"` (e.g. `"admin:owner"`). The hook validates the
// **base** segment so vendor invites still flow.
const ALLOWED_INVITE_ROLES = new Set(["admin", "member"])
const ALLOWED_UPDATE_ROLES = new Set(["admin", "member"])

function baseRole(role: string): string {
  return role.includes(":") ? (role.split(":")[0] ?? role) : role
}

function assertInviteRoleAllowed(role: string, ctx: string): void {
  const base = baseRole(role)
  if (!ALLOWED_INVITE_ROLES.has(base)) {
    console.warn(`[auth-server.${ctx}] rejected invitation role`, { role })
    throw new APIError("BAD_REQUEST", { message: "Invalid role" })
  }
}

// Exported for direct unit-test coverage of the org-plugin hooks.
// The exported functions are the SAME implementations the hooks
// call into below — no parallel source of truth.
export async function _hookBeforeCreateInvitation(role: string): Promise<void> {
  assertInviteRoleAllowed(role, "beforeCreateInvitation")
}
export async function _hookBeforeAcceptInvitation(role: string | null | undefined): Promise<void> {
  if (role) assertInviteRoleAllowed(role, "beforeAcceptInvitation")
}
export async function _hookBeforeUpdateMemberRole(newRole: string): Promise<void> {
  const base = baseRole(newRole)
  if (!ALLOWED_UPDATE_ROLES.has(base)) {
    console.warn("[auth-server.beforeUpdateMemberRole] rejected role", { newRole })
    throw new APIError("BAD_REQUEST", { message: "Invalid role" })
  }
}
export async function _hookBeforeRemoveMember(args: {
  memberRole: string
  memberId: string
  organizationId: string
}): Promise<void> {
  const role = baseRole(args.memberRole)
  if (role !== "admin" && role !== "owner") return
  const remaining = await prisma.member.count({
    where: { organizationId: args.organizationId, role: { in: ["admin", "owner"] } },
  })
  if (remaining <= 1) {
    console.warn("[auth-server.beforeRemoveMember] last admin protection", {
      organizationId: args.organizationId,
      memberId: args.memberId,
    })
    throw new APIError("BAD_REQUEST", {
      message: "Cannot remove the last admin of this organization",
    })
  }
}

// ─── trustedOrigins (CSRF mitigation) ────────────────────────────
//
// Better-auth validates the Origin/Referer of every auth API call
// against `trustedOrigins` + `baseURL`. Without this list, the only
// CSRF mitigation is the proxy.ts cookie-presence check. We include
// the canonical baseURL plus dev fallbacks; add Railway preview URLs
// here when those domains are known.
const trustedOrigins: string[] = [
  process.env.BETTER_AUTH_URL,
  process.env.NEXT_PUBLIC_SITE_URL,
  "http://localhost:3000",
  "https://tydei-app-production.up.railway.app",
].filter((o): o is string => typeof o === "string" && o.length > 0)

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: Array.from(new Set(trustedOrigins)),
  rateLimit: {
    window: 60,
    max: 100,
  },
  // ─── Cookie hardening ─────────────────────────────────────────
  //
  // better-auth 1.6 puts cookie config under `advanced`. The legacy
  // `session.cookie` block was silently ignored at runtime.
  // - `useSecureCookies: true` in production auto-prefixes session
  //   cookies with `__Secure-` (preserved by `cookiePrefix:
  //   "better-auth"` default), keeping proxy.ts's literal cookie
  //   names valid.
  // - `defaultCookieAttributes` apply to ALL better-auth cookies.
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    cookiePrefix: "better-auth",
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // refresh every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
      if (!resend) {
        throw new Error("Resend not configured: RESEND_API_KEY missing")
      }
      await resend.emails.send({
        from: "TYDEi <noreply@tydei.com>",
        to: user.email,
        subject: "Reset your password",
        html: `<a href="${url}">Reset password</a>`,
      })
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      if (!resend) {
        throw new Error("Resend not configured: RESEND_API_KEY missing")
      }
      await resend.emails.send({
        from: "TYDEi <noreply@tydei.com>",
        to: user.email,
        subject: "Verify your email",
        html: `<a href="${url}">Verify email</a>`,
      })
    },
  },
  plugins: [
    organization({
      organizationHooks: {
        beforeCreateInvitation: async ({ invitation }) => {
          await _hookBeforeCreateInvitation(invitation.role)
        },
        beforeAcceptInvitation: async ({ invitation }) => {
          // Belt-and-suspenders: re-validate at acceptance time so a
          // future bug that bypasses beforeCreateInvitation cannot
          // ride through.
          await _hookBeforeAcceptInvitation(invitation.role)
        },
        beforeUpdateMemberRole: async ({ newRole }) => {
          await _hookBeforeUpdateMemberRole(newRole)
        },
        beforeRemoveMember: async ({ member, organization: org }) => {
          await _hookBeforeRemoveMember({
            memberRole: member.role,
            memberId: member.id,
            organizationId: org.id,
          })
        },
      },
    }),
    ...(stripeClient && process.env.STRIPE_WEBHOOK_SECRET
      ? [
          stripe({
            stripeClient,
            stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          }),
        ]
      : []),
  ],
})
