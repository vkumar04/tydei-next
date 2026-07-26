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

  // Same normalization trap as adminCreateUser: better-auth lowercases every
  // email it looks up, so writing a mixed-case address here would make the
  // account invisible to sign-in and password reset alike.
  const data = input.email
    ? { ...input, email: normalizeEmail(input.email) }
    : input

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  })

  await logAudit({
    userId: session.user.id,
    action: "user.updated",
    entityType: "user",
    entityId: id,
    metadata: { updatedFields: Object.keys(input) },
  })

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
async function assertUserIsDeletable(
  ids: string[],
  callerId: string,
): Promise<void> {
  if (ids.includes(callerId)) {
    throw new Error("You cannot delete your own account.")
  }

  const targets = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, role: true },
  })
  const removingAdmins = targets.filter((u) => u.role === "admin").length
  if (removingAdmins === 0) return

  const totalAdmins = await prisma.user.count({ where: { role: "admin" } })
  if (totalAdmins - removingAdmins < 1) {
    throw new Error(
      "This would remove the last platform admin and lock everyone out of " +
        "the admin console. Create another admin first.",
    )
  }
}

export async function adminDeleteUser(id: string) {
  const session = await requireAdmin()
  await assertUserIsDeletable([id], session.user.id)

  const target = await prisma.user.findUnique({
    where: { id },
    select: { email: true, role: true },
  })

  await prisma.user.delete({ where: { id } })

  // Deletion was the only admin mutation with no audit trail — the most
  // destructive one, and the least recoverable.
  await logAudit({
    userId: session.user.id,
    action: "user.deleted",
    entityType: "user",
    entityId: id,
    metadata: { email: target?.email, role: target?.role },
  })
}

// ─── Bulk Delete Users ──────────────────────────────────────────

export async function adminBulkDeleteUsers(ids: string[]) {
  const session = await requireAdmin()
  // Same guards as the single delete. A Server Action is reachable by anyone
  // who can POST to it, so "the UI doesn't expose bulk delete" is not a
  // control — the check has to live here.
  await assertUserIsDeletable(ids, session.user.id)

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
