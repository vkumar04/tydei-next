import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"

export async function seedFeatureFlags(
  prisma: PrismaClient,
  deps: { facilities: Facilities }
) {
  const { facilities: f } = deps

  const facilityIds = Object.values(f).map((fac) => fac.id)

  await prisma.featureFlag.createMany({
    data: facilityIds.map((facilityId) => ({
      facilityId,
      purchaseOrdersEnabled: true,
      aiAgentEnabled: true,
      vendorPortalEnabled: true,
      advancedReportsEnabled: true,
      caseCostingEnabled: true,
    })),
  })

  console.log(`  Feature Flags: ${facilityIds.length}`)
}
