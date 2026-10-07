import { headers } from "next/headers"
import { auth } from "@/lib/auth-server"
import { prisma } from "@/lib/db"
import type { Facility, UserRole, Vendor } from "@/lib/generated/prisma/client"
import type { AccessTier } from "@/lib/auth/permissions"

type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>

export interface Principal {
  session: Session
  role: UserRole | null
  accessTier: AccessTier | null
  facility: Facility | null
  vendor: Vendor | null
}

export async function getSession(): Promise<Session | null> {
  "use cache: private"
  return auth.api.getSession({ headers: await headers() })
}

export async function getPrincipal(): Promise<Principal | null> {
  "use cache: private"
  const session = await getSession()
  if (!session) return null
  const [user, member] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    }),
    prisma.member.findFirst({
      where: { userId: session.user.id },
      select: {
        accessTier: true,
        organization: { select: { facility: true, vendor: true } },
      },
    }),
  ])
  return {
    session,
    role: user?.role ?? null,
    accessTier: member?.accessTier ?? null,
    facility: member?.organization?.facility ?? null,
    vendor: member?.organization?.vendor ?? null,
  }
}
