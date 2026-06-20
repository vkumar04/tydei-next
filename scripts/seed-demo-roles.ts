/**
 * Idempotent demo-role seeder. Adds per-access-tier demo logins so each role
 * can be tested on both the facility and vendor sides, without reseeding (safe
 * to run against an existing local OR prod DB).
 *
 *   Facility  Super     → demo-facility@tydei.com        (existing; ensured super)
 *   Facility  Advanced  → demo-facility-adv@tydei.com    (member, accessTier advanced)
 *   Facility  User (RO) → demo-facility-user@tydei.com   (member, accessTier user)
 *   Vendor    Super     → demo-vendor@tydei.com          (existing; ensured super)
 *   Vendor    Advanced  → demo-vendor-adv@tydei.com      (member, accessTier advanced)
 *   Vendor    User (RO) → demo-vendor-user@tydei.com     (member, accessTier user)
 *   Admin               → demo-admin@tydei.com           (existing; platform admin console)
 *
 * Facility accounts attach to the "Lighthouse Surgical Center" org
 * (slug lighthouse-surgical-center); vendor accounts to "Stryker" (slug stryker).
 *
 * Run local:  bunx tsx scripts/seed-demo-roles.ts
 * Run prod:   DATABASE_URL="<DATABASE_PUBLIC_URL>" bunx tsx scripts/seed-demo-roles.ts
 */
import { hashPassword } from "better-auth/crypto"
import { prisma } from "@/lib/db"
import type { AccessTier, UserRole } from "@/lib/generated/prisma/client"

const DEMO_PASSWORD = "demo-2024"

interface RoleSpec {
  email: string
  name: string
  role: UserRole
  orgSlug: string
  memberRole: string
  accessTier: AccessTier
}

const SPECS: RoleSpec[] = [
  { email: "demo-facility-adv@tydei.com", name: "Facility Advanced", role: "facility", orgSlug: "lighthouse-surgical-center", memberRole: "member", accessTier: "advanced" },
  { email: "demo-facility-user@tydei.com", name: "Facility User (Read-only)", role: "facility", orgSlug: "lighthouse-surgical-center", memberRole: "member", accessTier: "user" },
  { email: "demo-vendor-adv@tydei.com", name: "Vendor Advanced", role: "vendor", orgSlug: "stryker", memberRole: "member", accessTier: "advanced" },
  { email: "demo-vendor-user@tydei.com", name: "Vendor User (Read-only)", role: "vendor", orgSlug: "stryker", memberRole: "member", accessTier: "user" },
]

async function ensureAccount(userId: string, passwordHash: string) {
  const existing = await prisma.account.findFirst({
    where: { userId, providerId: "credential" },
    select: { id: true },
  })
  if (existing) {
    await prisma.account.update({ where: { id: existing.id }, data: { password: passwordHash } })
    return
  }
  await prisma.account.create({
    data: { userId, accountId: userId, providerId: "credential", password: passwordHash },
  })
}

async function ensureMember(userId: string, organizationId: string, memberRole: string, accessTier: AccessTier) {
  const existing = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { id: true },
  })
  if (existing) {
    await prisma.member.update({ where: { id: existing.id }, data: { role: memberRole, accessTier } })
    return
  }
  await prisma.member.create({ data: { userId, organizationId, role: memberRole, accessTier } })
}

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD)

  // Ensure the existing super demo accounts are explicitly accessTier=super.
  for (const email of ["demo-facility@tydei.com", "demo-vendor@tydei.com"]) {
    const u = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (u) {
      await prisma.member.updateMany({ where: { userId: u.id }, data: { accessTier: "super" } })
    }
  }

  for (const spec of SPECS) {
    const org = await prisma.organization.findUnique({
      where: { slug: spec.orgSlug },
      select: { id: true },
    })
    if (!org) {
      console.warn(`! org not found for slug "${spec.orgSlug}" — skipping ${spec.email}`)
      continue
    }

    const user = await prisma.user.upsert({
      where: { email: spec.email },
      update: { name: spec.name, role: spec.role, emailVerified: true },
      create: { name: spec.name, email: spec.email, role: spec.role, emailVerified: true, lastLoginAt: new Date() },
      select: { id: true },
    })

    await ensureAccount(user.id, passwordHash)
    await ensureMember(user.id, org.id, spec.memberRole, spec.accessTier)
    console.log(`✓ ${spec.email}  (${spec.role} · ${spec.accessTier})`)
  }

  console.log(`\nDone. Password for all new demo accounts: "${DEMO_PASSWORD}"`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
