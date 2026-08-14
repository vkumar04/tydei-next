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

/** From-address for account/transactional mail (reset, verify, invite). */
const AUTH_FROM = "TYDEi <noreply@tydei.com>"

/**
 * Human label for an org role. Vendor roles are stored colon-concatenated
 * ("admin:owner") — see `inviteVendorTeamMember` — so show the base segment
 * only, title-cased.
 */
export function roleLabelFor(role: string): string | undefined {
  const base = role.split(":")[0]?.trim()
  if (!base) return undefined
  return base.charAt(0).toUpperCase() + base.slice(1)
}

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
  // 2026-06-09 settings audit: count by BASE role segment in JS — a raw
  // `role IN ('admin','owner')` misses vendor sub-roled admins
  // ("admin:owner"), which both removed last-admin protection for
  // vendor orgs and false-blocked removals in multi-admin vendor orgs.
  const members = await prisma.member.findMany({
    where: { organizationId: args.organizationId },
    select: { role: true },
  })
  const remaining = members.filter((m) =>
    ["admin", "owner"].includes(baseRole(m.role)),
  ).length
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
  "https://tydei.com",
  "https://www.tydei.com",
  // Legacy Railway domain — keep until all traffic is on tydei.com.
  "https://tydei-app-production.up.railway.app",
].filter((o): o is string => typeof o === "string" && o.length > 0)

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  trustedOrigins: Array.from(new Set(trustedOrigins)),
  // experimental.joins (1.4+) — 2–3× perf on /get-session, but
  // disabled 2026-05-26 because the better-auth organization plugin
  // contributes an `activeOrganizationId` column to Session that our
  // schema doesn't have. Sign-in worked (we added stripeCustomerId
  // for the stripe plugin) but session reads (every authenticated
  // page request) 500'd with "Unknown field activeOrganizationId
  // for select statement on model Session". Re-enable AFTER adding
  // Session.activeOrganizationId (and any other plugin-contributed
  // columns surfaced by joins) in a follow-up migration.
  // experimental: { joins: true },
  // defaultCookieAttributes pins sameSite=lax explicitly; httpOnly +
  // secure are already the production defaults, kept here so the
  // policy is self-documenting in one place.
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
    // Without this the rate limiter has no client IP and buckets EVERY user
    // together: better-auth refuses to trust a multi-hop `x-forwarded-for`
    // (the leftmost token is client-controlled behind an appending proxy), so
    // `getIp` returns null and the key degrades to the literal
    // "no-trusted-ip|<path>". Confirmed live on 2026-08-14 — production logged
    // "Rate limiting could not determine a client IP and is falling back to a
    // single shared per-path bucket", which caps /sign-in/email at 10/min for
    // the WHOLE app and every other auth path at 100/min.
    //
    // Railway is the only thing in front of us (`server: railway-hikari`, no
    // CDN markers in the response headers). Measured against production on
    // 2026-08-14, a request arrives as:
    //
    //   x-forwarded-for: 173.92.72.77, 152.233.30.102   <- client, then edge
    //   x-real-ip:       173.92.72.77                   <- client
    //
    // Two XFF entries is what defeats better-auth's default. `x-real-ip`
    // carries the client on its own, so point the resolver at it directly:
    // a single-entry header needs no trusted-proxy chain walking.
    //
    // Both headers are edge-controlled, verified by replaying the request with
    // `X-Real-IP: 1.2.3.4` and `X-Forwarded-For: 9.9.9.9` — Railway discarded
    // both and delivered the real values, so this cannot be spoofed.
    //
    // Do NOT swap this for `trustedProxies`: Railway's hop here is 152.233.x,
    // not the 100.0.0.0/8 range their community docs cite, and the edge address
    // varies by POP — trusting a guessed CIDR silently resolves the EDGE as the
    // client and rebuckets every user behind that POP together.
    //
    // Watch item: Railway has an open bug where traffic through their CDN layer
    // sets x-real-ip to the POP address instead of the client. It is not
    // happening on this service today (x-real-ip matches the leftmost XFF
    // token). If sign-in rate limiting ever starts biting groups of users at
    // once, re-run the /api/health diagnostic below and compare the two.
    ipAddress: {
      ipAddressHeaders: ["x-real-ip"],
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
  // Brute-force / credential-stuffing / signup-spam protection on the
  // auth endpoints (2026-06-18 pre-prod audit: these were relying only on
  // better-auth's modest default limiter). NOTE: better-auth's limiter is
  // in-memory per-instance by default — fine at the current single Railway
  // instance; switch to `storage: "database"` (+ a RateLimit model) or a
  // shared store before horizontal scaling.
  rateLimit: {
    enabled: true,
    window: 60, // seconds
    max: 100, // default cap per window per IP
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 60, max: 5 },
      "/forget-password": { window: 60, max: 5 },
      "/reset-password": { window: 60, max: 10 },
    },
  },
  emailAndPassword: {
    enabled: true,
    // Explicit, self-documenting password policy (was implicit default 8).
    minPasswordLength: 8,
    maxPasswordLength: 128,
    // Require a verified email before sign-in. The verification email is
    // wired below via Resend. (Go-live dependency: Resend deliverability —
    // if verification mail isn't landing, flip this off until it is.)
    requireEmailVerification: true,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      if (!resend) {
        console.error(
          "[auth-server.sendResetPassword] RESEND_API_KEY missing — no reset email sent",
          { userId: user.id },
        )
        throw new Error("Email delivery is not configured. Contact support.")
      }
      const { resetPasswordEmail } = await import("@/lib/emails/render")
      const { subject, html, text } = await resetPasswordEmail({
        url,
        userName: user.name,
      })
      await resend.emails.send({
        from: AUTH_FROM,
        to: user.email,
        subject,
        html,
        text,
      })
    },
  },
  /**
   * Deactivated accounts cannot start a session.
   *
   * Hooked at SESSION creation rather than in the credential sign-in path, so
   * it covers every provider — anything that would mint a session for this
   * user is refused, including flows added later. Existing sessions are
   * revoked at the moment of deactivation (adminSetUserActive); this stops
   * new ones.
   *
   * Deactivation exists because hard-deleting a user is both blocked and
   * wrong here: audit_log.userId is RESTRICT, and the actor behind a
   * financial/PHI audit trail has to stay resolvable.
   */
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { deactivatedAt: true },
          })
          if (user?.deactivatedAt) {
            throw new APIError("FORBIDDEN", {
              message:
                "This account has been deactivated. Contact your administrator.",
            })
          }
          return { data: session }
        },
      },
    },
  },
  user: {
    /**
     * Email change, gated behind BOTH addresses.
     *
     * Why this exists: the Settings → Profile "Change email" button shipped
     * on both portals (`components/shared/settings/account-profile-card.tsx`)
     * while this option was absent, so better-auth threw
     * CHANGE_EMAIL_DISABLED on every attempt — the button never worked
     * (audit 2026-07-26).
     *
     * Flow: `sendChangeEmailConfirmation` goes to the CURRENT address for
     * approval; only after that does better-auth send the standard
     * verification link to the NEW address. Both must be clicked, so a
     * hijacked session cannot silently move the account to an attacker's
     * inbox and then password-reset into it.
     */
    changeEmail: {
      enabled: true,
      sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
        if (!resend) {
          console.error(
            "[auth-server.sendChangeEmailConfirmation] RESEND_API_KEY missing — email change cannot be confirmed",
            { userId: user.id },
          )
          return
        }
        try {
          const { changeEmailConfirmationEmail } = await import("@/lib/emails/render")
          const { subject, html, text } = await changeEmailConfirmationEmail({
            url,
            newEmail,
            userName: user.name,
          })
          await resend.emails.send({
            from: AUTH_FROM,
            to: user.email,
            subject,
            html,
            text,
          })
        } catch (err) {
          console.error("[auth-server.sendChangeEmailConfirmation]", err, {
            userId: user.id,
          })
        }
      },
    },
  },
  emailVerification: {
    // Re-send the verification link whenever an unverified user tries to
    // sign in. Without this, `requireEmailVerification: true` permanently
    // locks out anyone who loses the original email — there is no other
    // resend path in the product (audit 2026-07-26). Reaching this branch
    // requires a VALID password (sign-in.mjs rejects bad credentials
    // first), so it is not an open mail relay.
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!resend) {
        console.error(
          "[auth-server.sendVerificationEmail] RESEND_API_KEY missing — no verification email sent",
          { userId: user.id },
        )
        throw new Error("Email delivery is not configured. Contact support.")
      }
      const { verifyEmailEmail } = await import("@/lib/emails/render")
      const { subject, html, text } = await verifyEmailEmail({
        url,
        userName: user.name,
      })
      await resend.emails.send({
        from: AUTH_FROM,
        to: user.email,
        subject,
        html,
        text,
      })
    },
  },
  plugins: [
    organization({
      /**
       * Deliver the invitation email.
       *
       * Why this exists: before 2026-07-26 this option was absent, so
       * `inviteTeamMember` / `inviteVendorTeamMember` wrote an Invitation
       * row via `auth.api.createInvitation` and NOBODY was ever emailed —
       * the dialog reported "Sending…" and the invitee heard nothing. The
       * `teamInviteEmail` template existed but had no caller.
       *
       * better-auth calls this for both create and resend, and runs it in
       * the background, so a mail failure cannot roll back the invitation
       * row — log loudly rather than throwing into the void.
       */
      sendInvitationEmail: async (data) => {
        if (!resend) {
          console.error(
            "[auth-server.sendInvitationEmail] RESEND_API_KEY missing — invitation created but no email sent",
            { invitationId: data.id, email: data.email },
          )
          return
        }
        try {
          const { teamInviteEmail } = await import("@/lib/emails/render")
          const { appUrl } = await import("@/lib/site-url")
          const { subject, html, text } = await teamInviteEmail({
            inviterName:
              data.inviter.user.name || data.inviter.user.email || "A teammate",
            orgName: data.organization.name,
            inviteUrl: `${appUrl}/accept-invitation?id=${data.id}`,
            // Vendor sub-roles are stored colon-concatenated ("admin:owner");
            // show only the base segment.
            roleLabel: roleLabelFor(data.role),
          })
          await resend.emails.send({
            from: AUTH_FROM,
            to: data.email,
            subject,
            html,
            text,
          })
        } catch (err) {
          console.error("[auth-server.sendInvitationEmail]", err, {
            invitationId: data.id,
            email: data.email,
            organizationId: data.organization.id,
          })
        }
      },
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
