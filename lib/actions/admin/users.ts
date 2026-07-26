"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import { auth } from "@/lib/auth-server"
import type { UserRole } from "@/lib/generated/prisma/client"
import type { AdminCreateUserInput, AdminUpdateUserInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { normalizeEmail } from "@/lib/validators/email"

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
  // the boundary that writes to the DB and calls better-auth, so it does not
  // rely on an upstream caller having parsed through zod.
  const email = normalizeEmail(input.email)

  // Clean, actionable duplicate error rather than a unique-constraint throw.
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existing) throw new Error("A user with that email already exists.")

  const ctx = await authContext()
  const hashedPassword = await ctx.password.hash(input.password)

  const created = await ctx.internalAdapter.createUser({
    email,
    name: input.name,
    emailVerified: false,
  })
  await ctx.internalAdapter.createAccount({
    userId: created.id,
    providerId: "credential",
    accountId: created.id,
    password: hashedPassword,
  })

  // `role` is a tydei column better-auth's adapter drops, so it has to be
  // applied separately — without this every admin-created user silently
  // lands on the schema default (`facility`).
  const user = await prisma.user.update({
    where: { id: created.id },
    data: { role: input.role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  })

  await logAudit({
    userId: session.user.id,
    action: "user.created",
    entityType: "user",
    entityId: user.id,
    metadata: { email: user.email, role: user.role },
  })

  // Best-effort. The account is already complete and usable at this point;
  // a mail outage must not fail the action and strand a half-created user
  // that then blocks the retry with "already exists".
  try {
    await auth.api.sendVerificationEmail({ body: { email, callbackURL: "/" } })
  } catch (err) {
    console.error("[adminCreateUser] verification email failed", err, {
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

export async function adminDeleteUser(id: string) {
  await requireAdmin()

  await prisma.user.delete({ where: { id } })
}

// ─── Bulk Delete Users ──────────────────────────────────────────

export async function adminBulkDeleteUsers(ids: string[]) {
  await requireAdmin()

  const result = await prisma.user.deleteMany({ where: { id: { in: ids } } })

  return { deleted: result.count }
}
