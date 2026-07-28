"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import { auth } from "@/lib/auth-server"
import type { UserRole } from "@/lib/generated/prisma/client"
import type { AdminCreateUserInput, AdminUpdateUserInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { normalizeEmail } from "@/lib/validators/email"
import { randomUUID } from "node:crypto"

/**
 * Narrow view of better-auth's internal context.
 *
 * `auth.$context` is how you create a user WITHOUT signing anyone in.
 * `auth.api.signUpEmail` looks like the obvious choice but is wrong here for
 * two reasons (both observed 2026-07-26):
 *
 *  - It sends the verification email INSIDE the call (sign-up.mjs:246) and
 *    AFTER the user row is already committed. A mail failure therefore throws
 *    out of a half-finished create: the user exists, the role was never
 *    applied, and the admin sees an error — with the retry then blocked by
 *    "already exists".
 *  - It creates a Session and calls setSessionCookie for the NEW user
 *    (sign-up.mjs:256-261). Harmless today only because the `nextCookies()`
 *    integration isn't installed; adding it — the standard Next setup
 *    better-auth documents — would silently swap the admin's own session for
 *    the account they just provisioned.
 */
interface AuthInternalContext {
  password: { hash: (password: string) => Promise<string> }
  internalAdapter: {
    createUser: (data: {
      email: string
      name: string
      emailVerified: boolean
    }) => Promise<{ id: string }>
    createAccount: (data: {
      userId: string
      providerId: string
      accountId: string
      password: string
    }) => Promise<unknown>
    createVerificationValue: (data: {
      value: string
      identifier: string
      expiresAt: Date
    }) => Promise<unknown>
  }
}

function authContext(): Promise<AuthInternalContext> {
  return (auth as unknown as { $context: Promise<AuthInternalContext> }).$context
}

// ─── Types ───────────────────────────────────────────────────────

export interface AdminUserRow {
  id: string
  name: string
  email: string
  image: string | null
  role: UserRole
  userType: "facility" | "vendor" | "operator"
  organizationName: string | null
  createdAt: string
  lastLoginAt: string | null
  /** Null when the account is active. Deactivated users cannot sign in. */
  deactivatedAt: string | null
}

// ─── List Users ─────────────────────────────────────────────────

export async function adminGetUsers(input: {
  search?: string
  role?: UserRole
  page?: number
  pageSize?: number
}): Promise<{ users: AdminUserRow[]; total: number }> {
  await requireAdmin()
  const { search, role, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
    ]
  }
  if (role) where.role = role

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        members: {
          include: { organization: { select: { name: true } } },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ])

  return serialize({
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      image: u.image,
      role: u.role,
      userType:
        u.role === "facility"
          ? ("facility" as const)
          : u.role === "vendor"
            ? ("vendor" as const)
            : ("operator" as const),
      organizationName: u.members[0]?.organization?.name ?? null,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
      deactivatedAt: u.deactivatedAt ? u.deactivatedAt.toISOString() : null,
    })),
    total,
  })
}

/**
 * Turn the Access step's selections into the rows that actually grant access.
 *
 * Two different models, both required:
 *   Member              links the user to an Organization. Without at least
 *                       one, requireFacility()/requireVendor() find no org and
 *                       the account cannot load a portal at all.
 *   FacilityAssignment  the enterprise-vs-scoped model. Only meaningful for
 *                       facility users, and only when they should see a
 *                       SUBSET of their health system.
 *
 * Facility.organizationId and Vendor.organizationId are both nullable, so a
 * selection that has no organization yields no Member row — reported rather
 * than silently producing an account that cannot sign in anywhere.
 */
async function resolveAccessGrants(input: AdminCreateUserInput): Promise<{
  organizationIds: string[]
  orgNames: string[]
  facilityIds: string[]
}> {
  // A platform admin is not scoped to any tenant.
  if (input.role === "admin") {
    return { organizationIds: [], orgNames: [], facilityIds: [] }
  }

  if (input.role === "vendor") {
    if (input.vendorIds.length === 0) {
      return { organizationIds: [], orgNames: [], facilityIds: [] }
    }
    const vendors = await prisma.vendor.findMany({
      where: { id: { in: input.vendorIds } },
      select: { id: true, name: true, organizationId: true },
    })
    assertAllResolved(input.vendorIds, vendors, "vendor")
    const unlinked = vendors.filter((v) => !v.organizationId)
    if (unlinked.length > 0) {
      throw new Error(
        `${unlinked.map((v) => v.name).join(", ")} has no organization yet, so ` +
          `access can't be granted. Set that up first.`,
      )
    }
    return {
      organizationIds: vendors.map((v) => v.organizationId as string),
      orgNames: vendors.map((v) => v.name),
      facilityIds: [],
    }
  }

  // facility
  if (input.facilityIds.length === 0) {
    return { organizationIds: [], orgNames: [], facilityIds: [] }
  }
  const facilities = await prisma.facility.findMany({
    where: { id: { in: input.facilityIds } },
    select: { id: true, name: true, organizationId: true },
  })
  assertAllResolved(input.facilityIds, facilities, "facility")
  const unlinked = facilities.filter((f) => !f.organizationId)
  if (unlinked.length > 0) {
    throw new Error(
      `${unlinked.map((f) => f.name).join(", ")} has no organization yet, so ` +
        `access can't be granted. Set that up first.`,
    )
  }
  return {
    organizationIds: [
      ...new Set(facilities.map((f) => f.organizationId as string)),
    ],
    orgNames: facilities.map((f) => f.name),
    facilityIds: facilities.map((f) => f.id),
  }
}

/** A selected id that doesn't exist is a client bug or a probe — never silent. */
function assertAllResolved(
  requested: string[],
  found: { id: string }[],
  label: string,
): void {
  if (found.length === requested.length) return
  const missing = requested.filter((id) => !found.some((f) => f.id === id))
  throw new Error(`Unknown ${label}: ${missing.join(", ")}`)
}

/**
 * Mint a set-password link and send the invite.
 *
 * Uses better-auth's own `reset-password:<token>` verification record, so the
 * existing /reset-password page and endpoint consume it unchanged — and
 * because the account has no credential yet, better-auth CREATES one on first
 * use (api/routes/password.mjs: if no "credential" account exists it calls
 * createAccount). That is what turns the invite into a working sign-in.
 */
async function sendAccountInvite(args: {
  userId: string
  email: string
  userName: string
  invitedByName?: string | null
  role: UserRole
  orgNames: string[]
}): Promise<void> {
  const ctx = await authContext()
  const token = randomUUID()

  await ctx.internalAdapter.createVerificationValue({
    value: args.userId,
    identifier: `reset-password:${token}`,
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  })

  const { accountInviteEmail } = await import("@/lib/emails/render")
  const { appUrl } = await import("@/lib/site-url")
  const { subject, html, text } = await accountInviteEmail({
    // `invite=1` only changes the page copy to "Set your password".
    url: `${appUrl}/reset-password?token=${token}&invite=1`,
    userName: args.userName,
    invitedByName: args.invitedByName,
    roleLabel: ROLE_LABELS[args.role],
    organizations: args.orgNames,
  })

  const { sendEmail } = await import("@/lib/email")
  await sendEmail({ to: args.email, subject, html, text })
}

/** Invite links last a week; the email says so. */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const ROLE_LABELS: Record<UserRole, string> = {
  facility: "Facility",
  vendor: "Vendor",
  admin: "Platform admin",
}

// ─── Create User ────────────────────────────────────────────────

/**
 * Create a platform user from the admin portal.
 *
 * This used to be `prisma.user.create({ ...userData, emailVerified: true })`
 * with the password destructured away, which produced an account that was
 * unusable in three separate ways (found 2026-07-26 after a real invite went
 * nowhere):
 *
 *   1. The password the form collects — required, min 8 — was DISCARDED, so
 *      no `Account` row with providerId "credential" was ever written and
 *      there was nothing to sign in with.
 *   2. No email was sent, so the person never learned the account existed.
 *   3. The email was stored verbatim. better-auth's `findUserByEmail`
 *      lowercases its input and matches exactly against a plain `text`
 *      column, so a mixed-case address was invisible to EVERY auth path —
 *      including "forgot password", which fails silently by design to avoid
 *      leaking whether an account exists. The account was unreachable.
 *
 * The fix creates the user through better-auth's internal context (see
 * AuthInternalContext above for why NOT `auth.api.signUpEmail`): a real
 * hashed credential, a normalized email, no session, and the verification
 * email sent AFTER the account is complete so a mail outage can't strand a
 * half-created user. Every role gets mail — there is no role-conditional
 * path.
 */
export async function adminCreateUser(input: AdminCreateUserInput) {
  const session = await requireAdmin()

  // Belt-and-braces: adminCreateUserSchema already normalizes, but this is
  // the boundary that writes to the DB, so it does not rely on an upstream
  // caller having parsed through zod.
  const email = normalizeEmail(input.email)

  // Clean, actionable duplicate error rather than a unique-constraint throw.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existing) throw new Error("A user with that email already exists.")

  // Resolve the access selections BEFORE writing anything, so a bad id fails
  // the whole thing rather than leaving a user with partial access.
  const { organizationIds, orgNames, facilityIds } = await resolveAccessGrants(
    input,
  )

  const ctx = await authContext()

  // NO credential is created. The admin does not choose the password — the
  // invite below carries a set-password link, and better-auth's reset flow
  // mints the credential the first time it is used. That keeps the password
  // known only to its owner (2026-07-26 redesign).
  // emailVerified: true is deliberate, and load-bearing.
  //
  // `requireEmailVerification: true` blocks sign-in for unverified addresses,
  // and better-auth's resetPassword does NOT set emailVerified (verified in
  // api/routes/password.mjs — it only creates/updates the credential). So a
  // user created as unverified would set their password from the invite link
  // and then STILL be unable to sign in, with no obvious way forward. A dead
  // end we would have shipped.
  //
  // Marking it verified here is also the honest reading: the invite goes to
  // this address and the ONLY way to activate the account is the token inside
  // it, so possession proves control of the inbox — the same proof a
  // verification email provides. Until that link is used the account has no
  // credential at all, so a verified-but-unactivated row cannot sign in.
  const created = await ctx.internalAdapter.createUser({
    email,
    name: input.name,
    emailVerified: true,
  })

  // `role`, Member rows and FacilityAssignment rows are all tydei-side, and
  // an account that exists without its access grants is worse than no account
  // at all — so they land together or not at all.
  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: created.id },
      data: { role: input.role },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    })

    if (organizationIds.length > 0) {
      await tx.member.createMany({
        data: organizationIds.map((organizationId) => ({
          organizationId,
          userId: u.id,
          role: "member",
          // Set the tier EXPLICITLY. `Member.accessTier` is `@default(super)`,
          // and the schema comment says why: "Defaults to `super` so existing
          // members keep full access until explicitly demoted" — that default
          // exists to backfill members who predate the tier, NOT to grant a
          // tier to someone being created now. Because this createMany omitted
          // the field, every user an admin provisioned silently landed at the
          // HIGHEST tier: `getCurrentAccessContext` reads accessTier, so they
          // passed requireCanMutate(), requireCan("settings.manage") and
          // requireCan("members.manage") — full mutate rights plus the ability
          // to re-tier other members. The create form collects no tier at all,
          // so there was not even a choice being ignored. Least privilege by
          // default; the caller opts up. Charles 2026-07-28 sweep.
          accessTier: input.accessTier ?? "user",
        })),
        skipDuplicates: true,
      })
    }

    if (facilityIds.length > 0) {
      await tx.facilityAssignment.createMany({
        data: facilityIds.map((facilityId) => ({ userId: u.id, facilityId })),
        skipDuplicates: true,
      })
    }

    return u
  })

  await logAudit({
    userId: session.user.id,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    metadata: {
      email: user.email,
      role: user.role,
      organizations: orgNames,
      facilityIds,
    },
  })

  // Best-effort: the account and its access are already committed. A mail
  // outage must not fail the action and strand a user that then blocks the
  // retry with "already exists" — they can still use "Forgot password".
  try {
    await sendAccountInvite({
      userId: user.id,
      email,
      userName: user.name,
      invitedByName: session.user.name,
      role: user.role,
      orgNames,
    })
  } catch (err) {
    console.error("[adminCreateUser] invite email failed", err, {
      email,
      userId: user.id,
    })
  }

  return serialize(user)
}

// ─── Update User ────────────────────────────────────────────────

export async function adminUpdateUser(id: string, input: AdminUpdateUserInput) {
  const session = await requireAdmin()

  const before = await prisma.user.findUnique({
    where: { id },
    select: { email: true, name: true, role: true },
  })
  if (!before) throw new Error("User not found.")

  // Same normalization trap as adminCreateUser: better-auth lowercases every
  // email it looks up, so writing a mixed-case address here would make the
  // account invisible to sign-in and password reset alike.
  const nextEmail = input.email ? normalizeEmail(input.email) : undefined
  const data = nextEmail ? { ...input, email: nextEmail } : input

  // Demotion removes an admin exactly as deletion does. Guarding delete but
  // not role change just moved the door (audit 2026-07-26).
  const losingAdmin = before.role === "admin" && input.role && input.role !== "admin"
  if (losingAdmin) {
    assertNotSelf([id], session.user.id, "demote")
    await assertLeavesAnAdminStanding([id])
  }

  const emailChanged = !!nextEmail && nextEmail !== before.email

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  })

  // Any reduction in privilege must end live sessions, or the old role keeps
  // working for up to the 7-day session lifetime. An email change is treated
  // the same way: if it was not the owner's doing, the attacker's session
  // should not survive it either.
  const revoked =
    losingAdmin || emailChanged || input.role !== undefined
      ? await revokeAllSessions([id])
      : 0

  await logAudit({
    userId: session.user.id,
    action: emailChanged ? "user.email_changed" : "user.updated",
    entityType: "user",
    entityId: id,
    metadata: {
      updatedFields: Object.keys(input),
      ...(emailChanged ? { previousEmail: before.email, newEmail: nextEmail } : {}),
      ...(losingAdmin ? { demotedFrom: "admin", newRole: input.role } : {}),
      sessionsRevoked: revoked,
    },
  })

  // An admin can change any address with no confirmation, and "change the
  // email, then use forgot-password" is a complete account takeover. The
  // self-service flow is double-gated (current address approves, new address
  // verifies); this path cannot be, so at minimum the FORMER owner is told,
  // out-of-band, that it happened. Best-effort — a mail outage must not roll
  // back a legitimate correction.
  if (emailChanged && before.email) {
    try {
      const { adminEmailChangedEmail } = await import("@/lib/emails/render")
      const { sendEmail } = await import("@/lib/email")
      const { subject, html, text } = await adminEmailChangedEmail({
        userName: before.name,
        previousEmail: before.email,
        newEmail: nextEmail as string,
        changedByName: session.user.name,
      })
      await sendEmail({ to: before.email, subject, html, text })
    } catch (err) {
      console.error("[adminUpdateUser] email-change notice failed", err, {
        userId: id,
      })
    }
  }

  return serialize(user)
}

// ─── Delete User ────────────────────────────────────────────────

/**
 * Platform-admin deletion is a one-way door with no recovery path, so it
 * carries two guards the org-level equivalent already had
 * (`_hookBeforeRemoveMember` in lib/auth-server.ts) but this did not:
 *
 *  - You cannot delete yourself. The session survives momentarily, then every
 *    subsequent request 302s to /login with no way back in.
 *  - You cannot remove the last platform admin. `/admin` is gated on
 *    `UserRole: admin`, so zero admins means the operator console is
 *    permanently unreachable — there is no self-service way to mint a new one.
 *
 * That second case is not hypothetical: production currently has exactly ONE
 * admin, and it is the seeded demo account that launch hardening says to
 * delete. Doing so without this guard would brick the console (audit
 * 2026-07-26).
 */
/**
 * The one place "would this leave the platform without an operator?" is
 * decided. Shared by delete, deactivate, and role change — all three can
 * remove the last admin, and guarding only one of them just moves the door.
 *
 * `/admin` is gated on `UserRole: admin`. Zero admins means the operator
 * console is unreachable with no self-service recovery. Production runs with
 * exactly ONE admin today, so this is a live hazard, not a theoretical one.
 */
async function assertLeavesAnAdminStanding(
  losingAdminIds: string[],
): Promise<void> {
  if (losingAdminIds.length === 0) return

  const targets = await prisma.user.findMany({
    where: { id: { in: losingAdminIds }, role: "admin", deactivatedAt: null },
    select: { id: true },
  })
  if (targets.length === 0) return

  // Only ACTIVE admins count — a deactivated one cannot sign in, so it is not
  // a way back into the console.
  const activeAdmins = await prisma.user.count({
    where: { role: "admin", deactivatedAt: null },
  })
  if (activeAdmins - targets.length < 1) {
    throw new Error(
      "This would remove the last active platform admin and lock everyone " +
        "out of the admin console. Create or reactivate another admin first.",
    )
  }
}

/** You cannot switch off your own access; the session outlives the request. */
function assertNotSelf(ids: string[], callerId: string, verb: string): void {
  if (ids.includes(callerId)) {
    throw new Error(`You cannot ${verb} your own account.`)
  }
}

/**
 * Reasons a user cannot be hard-deleted, in the caller's language.
 *
 * audit_log.userId is RESTRICT, so `prisma.user.delete` throws a raw FK error
 * for anyone who has performed an audited action — production has an account
 * with 468 such rows. Beyond the error: deleting the actor behind a
 * financial/PHI audit trail defeats the trail. Deactivation is the answer,
 * and the message says so.
 */
async function describeDeleteBlockers(ids: string[]): Promise<string[]> {
  const [auditRows, renewalNotes, insightFlags] = await Promise.all([
    prisma.auditLog.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.renewalNote.count({ where: { authorId: { in: ids } } }),
    prisma.rebateInsightFlag.count({ where: { flaggedBy: { in: ids } } }),
  ])
  const audits = auditRows.reduce((sum, r) => sum + r._count._all, 0)

  const blockers: string[] = []
  if (audits) blockers.push(`${audits} audit-log entr${audits === 1 ? "y" : "ies"}`)
  if (renewalNotes) blockers.push(`${renewalNotes} renewal note(s)`)
  if (insightFlags) blockers.push(`${insightFlags} rebate insight flag(s)`)
  return blockers
}

/**
 * End every live session for these users.
 *
 * better-auth's own `revokeSessions` endpoint acts on the CALLER's sessions,
 * so admin-initiated revocation goes straight at the Session table (which is
 * ours). Without this a demoted or deactivated user keeps working for up to
 * the session lifetime — 7 days, and the 5-minute cookie cache means even a
 * fresh check lags (audit 2026-07-26 found 10 live sessions).
 */
async function revokeAllSessions(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0
  const { count } = await prisma.session.deleteMany({
    where: { userId: { in: userIds } },
  })
  return count
}

export async function adminDeleteUser(id: string) {
  const session = await requireAdmin()
  assertNotSelf([id], session.user.id, "delete")
  await assertLeavesAnAdminStanding([id])

  const blockers = await describeDeleteBlockers([id])
  if (blockers.length > 0) {
    throw new Error(
      `This user has ${blockers.join(", ")} and can't be deleted — that ` +
        `history has to stay attached to whoever performed it. Deactivate ` +
        `them instead: they lose access immediately and the record is kept.`,
    )
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { email: true, role: true },
  })

  await revokeAllSessions([id])
  await prisma.user.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "user.deleted",
    entityType: "user",
    entityId: id,
    metadata: { email: target?.email, role: target?.role },
  })
}

export async function adminBulkDeleteUsers(ids: string[]) {
  const session = await requireAdmin()
  // A Server Action is reachable by anyone who can POST to it, so "the UI
  // doesn't expose bulk delete" is not a control — the checks live here.
  assertNotSelf(ids, session.user.id, "delete")
  await assertLeavesAnAdminStanding(ids)

  const blockers = await describeDeleteBlockers(ids)
  if (blockers.length > 0) {
    throw new Error(
      `Some of these users have ${blockers.join(", ")} and can't be deleted. ` +
        `Deactivate them instead to keep the record intact.`,
    )
  }

  await revokeAllSessions(ids)
  const result = await prisma.user.deleteMany({ where: { id: { in: ids } } })

  await logAudit({
    userId: session.user.id,
    action: "user.bulk_deleted",
    entityType: "user",
    entityId: ids.join(","),
    metadata: { count: result.count, ids },
  })

  return { deleted: result.count }
}

/**
 * Offboard without erasing history — the path you want in almost every real
 * case. Blocks sign-in (checked in lib/auth-server.ts) and ends live sessions
 * immediately, while every audit entry keeps pointing at a real person.
 */
export async function adminSetUserActive(id: string, active: boolean) {
  const session = await requireAdmin()

  if (!active) {
    assertNotSelf([id], session.user.id, "deactivate")
    // Deactivation removes an admin just as surely as deletion does.
    await assertLeavesAnAdminStanding([id])
  }

  const user = await prisma.user.update({
    where: { id },
    data: { deactivatedAt: active ? null : new Date() },
    select: { id: true, name: true, email: true, role: true, createdAt: true, deactivatedAt: true },
  })

  const revoked = active ? 0 : await revokeAllSessions([id])

  await logAudit({
    userId: session.user.id,
    action: active ? "user.reactivated" : "user.deactivated",
    entityType: "user",
    entityId: id,
    metadata: { email: user.email, role: user.role, sessionsRevoked: revoked },
  })

  return serialize(user)
}
