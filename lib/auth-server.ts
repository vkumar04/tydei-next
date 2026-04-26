import { betterAuth } from "better-auth"
import { APIError } from "better-auth/api"
import { prismaAdapter } from "better-auth/adapters/prisma"
import { organization } from "better-auth/plugins"
import { stripe } from "@better-auth/stripe"
import Stripe from "stripe"
import { Resend } from "resend"
import { prisma } from "@/lib/db"

const stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY!)
const resend = new Resend(process.env.RESEND_API_KEY)

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

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  rateLimit: {
    window: 60,
    max: 100,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24,      // refresh every 24 hours
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: async ({ user, url }) => {
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
    stripe({
      stripeClient,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    }),
  ],
})
