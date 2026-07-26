"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import { auth } from "@/lib/auth-server"
import type { UserRole } from "@/lib/generated/prisma/client"
import type { AdminCreateUserInput, AdminUpdateUserInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { normalizeEmail } from "@/lib/validators/email"

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
 * Going through `auth.api.signUpEmail` fixes all three at once: better-auth
 * normalizes the email, hashes the password into a real credential account,
 * and (because `sendOnSignUp` inherits `requireEmailVerification`) sends the
 * verification email. Every created user gets mail regardless of role.
 *
 * `role` is ours, not better-auth's, so it is applied immediately after —
 * better-auth would otherwise leave the schema default (`facility`).
 */
export async function adminCreateUser(input: AdminCreateUserInput) {
  const session = await requireAdmin()

  // Belt-and-braces: adminCreateUserSchema already normalizes, but this is
  // the boundary that writes to the DB and calls better-auth, so it does not
  // rely on an upstream caller having parsed through zod.
  const email = normalizeEmail(input.email)

  let created: Awaited<ReturnType<typeof auth.api.signUpEmail>>
  try {
    created = await auth.api.signUpEmail({
      body: { email, password: input.password, name: input.name },
    })
  } catch (err) {
    console.error("[adminCreateUser] signUpEmail failed", err, { email })
    throw new Error(
      err instanceof Error && /exist/i.test(err.message)
        ? "A user with that email already exists."
        : "Could not create the user. Check the server logs for details.",
    )
  }

  // `role` is a tydei column better-auth knows nothing about; without this
  // every admin-created user would silently land as `facility`.
  const user = await prisma.user.update({
    where: { id: created.user.id },
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
