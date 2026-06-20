"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
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

export async function requestPasswordReset(email: string) {
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: "/reset-password" },
  })
}

export async function resetPassword(token: string, newPassword: string) {
  await auth.api.resetPassword({
    body: { token, newPassword },
  })
}
