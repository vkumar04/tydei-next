"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import type { UserRole } from "@prisma/client"
import type { AdminCreateUserInput, AdminUpdateUserInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

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

export async function adminCreateUser(input: AdminCreateUserInput) {
  const session = await requireAdmin()

  const { password: _password, ...userData } = input

  const user = await prisma.user.create({
    data: {
      ...userData,
      emailVerified: true,
    },
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

  const user = await prisma.user.update({
    where: { id },
    data: input,
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
