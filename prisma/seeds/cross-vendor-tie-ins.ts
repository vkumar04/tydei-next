import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"

const now = new Date()
const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate())
const oneYearFromNow = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate())

/**
 * Cross-Vendor Tie-In seed (v0 doc §4 — facility GPO bundle).
 *
 * Realistic example: Lighthouse Surgical Center signs a multi-vendor
 * GPO bundle covering its top three orthopedic / sports-medicine
 * suppliers. Each vendor commits to an annual minimum spend in
 * exchange for a vendor-specific rebate %, and the facility gets a
 * 1% bonus on the bundle's total spend if all three hit their
 * minimums.
 */
export async function seedCrossVendorTieIns(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors },
) {
  const { facilities, vendors } = deps
  let count = 0

  const tieIn = await prisma.crossVendorTieIn.create({
    data: {
      facilityId: facilities.lighthouseSurgical.id,
      name: "Lighthouse Ortho Bundle 2026",
      facilityBonusRate: 1.0,
      facilityBonusRequirement: "all_compliant",
      status: "active",
      effectiveDate: oneYearAgo,
      expirationDate: oneYearFromNow,
      members: {
        create: [
          {
            vendorId: vendors.stryker.id,
            minimumSpend: 1_500_000,
            rebateContribution: 2.5,
          },
          {
            vendorId: vendors.smithNephew.id,
            minimumSpend: 600_000,
            rebateContribution: 2.0,
          },
          {
            vendorId: vendors.arthrex.id,
            minimumSpend: 400_000,
            rebateContribution: 2.0,
          },
        ],
      },
    },
  })
  count++
  console.log(`  Cross-vendor tie-ins: ${count} (${tieIn.name})`)
  return count
}
