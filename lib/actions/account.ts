"use server"

import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"

export interface MyAccount {
  id: string
  name: string
  email: string
  emailVerified: boolean
}

/**
 * Returns the session user's own identity fields. Self-scoped — there is
 * no tenant boundary to enforce (a user can always read their own
 * account), but we still resolve the id from the session, never from a
 * client-supplied argument.
 */
export async function getMyAccount(): Promise<MyAccount> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    throw new Error("Not authenticated")
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, emailVerified: true },
  })
  if (!user) {
    throw new Error("Account not found")
  }

  return user
}
