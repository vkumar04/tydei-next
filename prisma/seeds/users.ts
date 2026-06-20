import type { PrismaClient } from "@/lib/generated/prisma/client"
import { hashPassword } from "better-auth/crypto"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

export async function seedUsers(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors }
) {
  const { facilities, vendors } = deps

  // --- Organizations for key facilities and vendors ---
  const lighthouseOrg = await prisma.organization.create({
    data: { name: "Lighthouse Surgical Center", slug: "lighthouse-surgical-center" },
  })
  await prisma.facility.update({
    where: { id: facilities.lighthouseSurgical.id },
    data: { organizationId: lighthouseOrg.id },
  })

  const heritageOrg = await prisma.organization.create({
    data: { name: "Heritage Regional Medical Center", slug: "heritage-regional" },
  })
  await prisma.facility.update({
    where: { id: facilities.heritageRegional.id },
    data: { organizationId: heritageOrg.id },
  })

  const summitOrg = await prisma.organization.create({
    data: { name: "Summit General Hospital", slug: "summit-general" },
  })
  await prisma.facility.update({
    where: { id: facilities.summitGeneral.id },
    data: { organizationId: summitOrg.id },
  })

  const strykerOrg = await prisma.organization.create({
    data: { name: "Stryker", slug: "stryker" },
  })
  await prisma.vendor.update({
    where: { id: vendors.stryker.id },
    data: { organizationId: strykerOrg.id },
  })

  const medtronicOrg = await prisma.organization.create({
    data: { name: "Medtronic", slug: "medtronic" },
  })
  await prisma.vendor.update({
    where: { id: vendors.medtronic.id },
    data: { organizationId: medtronicOrg.id },
  })

  // --- Hash passwords ---
  const facilityHash = await hashPassword("demo-facility-2024")
  const vendorHash = await hashPassword("demo-vendor-2024")
  const adminHash = await hashPassword("demo-admin-2024")
  const memberHash = await hashPassword("member-2024")
  // Per-access-tier demo logins (Advanced / User) share one password.
  const demoTierHash = await hashPassword("demo-2024")

  // --- Demo: facility user ---
  const facilityUser = await prisma.user.create({
    data: { name: "Facility Demo", email: "demo-facility@tydei.com", emailVerified: true, role: "facility", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: facilityUser.id, accountId: facilityUser.id, providerId: "credential", password: facilityHash },
  })
  await prisma.member.create({
    data: { userId: facilityUser.id, organizationId: lighthouseOrg.id, role: "admin" },
  })

  // --- Demo: facility Advanced + User (read-only) tiers ---
  // accessTier drives the Settings/Users gates; org role stays "member".
  const facilityAdv = await prisma.user.create({
    data: { name: "Facility Advanced", email: "demo-facility-adv@tydei.com", emailVerified: true, role: "facility", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: facilityAdv.id, accountId: facilityAdv.id, providerId: "credential", password: demoTierHash },
  })
  await prisma.member.create({
    data: { userId: facilityAdv.id, organizationId: lighthouseOrg.id, role: "member", accessTier: "advanced" },
  })

  const facilityRO = await prisma.user.create({
    data: { name: "Facility User (Read-only)", email: "demo-facility-user@tydei.com", emailVerified: true, role: "facility", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: facilityRO.id, accountId: facilityRO.id, providerId: "credential", password: demoTierHash },
  })
  await prisma.member.create({
    data: { userId: facilityRO.id, organizationId: lighthouseOrg.id, role: "member", accessTier: "user" },
  })

  // --- Demo: vendor user ---
  const vendorUser = await prisma.user.create({
    data: { name: "Vendor Demo", email: "demo-vendor@tydei.com", emailVerified: true, role: "vendor", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: vendorUser.id, accountId: vendorUser.id, providerId: "credential", password: vendorHash },
  })
  await prisma.member.create({
    data: { userId: vendorUser.id, organizationId: strykerOrg.id, role: "admin" },
  })

  // --- Demo: vendor Advanced + User (read-only) tiers ---
  const vendorAdv = await prisma.user.create({
    data: { name: "Vendor Advanced", email: "demo-vendor-adv@tydei.com", emailVerified: true, role: "vendor", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: vendorAdv.id, accountId: vendorAdv.id, providerId: "credential", password: demoTierHash },
  })
  await prisma.member.create({
    data: { userId: vendorAdv.id, organizationId: strykerOrg.id, role: "member", accessTier: "advanced" },
  })

  const vendorRO = await prisma.user.create({
    data: { name: "Vendor User (Read-only)", email: "demo-vendor-user@tydei.com", emailVerified: true, role: "vendor", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: vendorRO.id, accountId: vendorRO.id, providerId: "credential", password: demoTierHash },
  })
  await prisma.member.create({
    data: { userId: vendorRO.id, organizationId: strykerOrg.id, role: "member", accessTier: "user" },
  })

  // --- Demo: admin user ---
  const adminUser = await prisma.user.create({
    data: { name: "Admin Demo", email: "demo-admin@tydei.com", emailVerified: true, role: "admin", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: adminUser.id, accountId: adminUser.id, providerId: "credential", password: adminHash },
  })

  // --- Extra team members ---
  const sarahChen = await prisma.user.create({
    data: { name: "Sarah Chen", email: "sarah.chen@lighthouse.com", emailVerified: true, role: "facility", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: sarahChen.id, accountId: sarahChen.id, providerId: "credential", password: memberHash },
  })
  await prisma.member.create({
    data: { userId: sarahChen.id, organizationId: lighthouseOrg.id, role: "member" },
  })

  const jamesWilson = await prisma.user.create({
    data: { name: "James Wilson", email: "james.wilson@stryker.com", emailVerified: true, role: "vendor", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: jamesWilson.id, accountId: jamesWilson.id, providerId: "credential", password: memberHash },
  })
  await prisma.member.create({
    data: { userId: jamesWilson.id, organizationId: strykerOrg.id, role: "member" },
  })

  const mariaGarcia = await prisma.user.create({
    data: { name: "Maria Garcia", email: "maria.garcia@medtronic.com", emailVerified: true, role: "vendor", lastLoginAt: new Date() },
  })
  await prisma.account.create({
    data: { userId: mariaGarcia.id, accountId: mariaGarcia.id, providerId: "credential", password: memberHash },
  })
  await prisma.member.create({
    data: { userId: mariaGarcia.id, organizationId: medtronicOrg.id, role: "member" },
  })

  const users = { facilityUser, vendorUser, adminUser, sarahChen, jamesWilson, mariaGarcia }
  const organizations = { lighthouseOrg, heritageOrg, summitOrg, strykerOrg, medtronicOrg }

  console.log("  Users: 10 (3 demo + 4 access-tier demos + 3 team members)")
  console.log("  Organizations: 5 (3 facility + 2 vendor)")

  return { users, organizations }
}

export type Users = Awaited<ReturnType<typeof seedUsers>>["users"]
export type Organizations = Awaited<ReturnType<typeof seedUsers>>["organizations"]
