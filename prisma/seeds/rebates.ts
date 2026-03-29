import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Contracts } from "./contracts"

const now = new Date()

function quarterStart(quartersAgo: number) {
  const month = now.getMonth() - quartersAgo * 3
  return new Date(now.getFullYear(), month, 1)
}

function quarterEnd(quartersAgo: number) {
  const month = now.getMonth() - quartersAgo * 3 + 3
  return new Date(now.getFullYear(), month, 0)
}

function rand(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

export async function seedRebates(
  prisma: PrismaClient,
  deps: { contracts: Contracts; facilities: Facilities }
) {
  const { contracts: c, facilities: f } = deps

  const configs = [
    { contractId: c.strykerJoint.id, facilityId: f.lighthouseSurgical.id, earnedRange: [8000, 25000] },
    { contractId: c.medtronicSpine.id, facilityId: f.lighthouseCommunity.id, earnedRange: [4000, 12000] },
    { contractId: c.depuyTrauma.id, facilityId: f.summitGeneral.id, earnedRange: [3000, 10000] },
    { contractId: c.zbKnee.id, facilityId: f.heritageRegional.id, earnedRange: [5000, 15000] },
    { contractId: c.arthrexLighthouse.id, facilityId: f.lighthouseSurgical.id, earnedRange: [2000, 6000] },
  ]

  const records: Parameters<typeof prisma.rebate.create>[0]["data"][] = []

  for (const cfg of configs) {
    for (let q = 3; q >= 0; q--) {
      const earned = rand(cfg.earnedRange[0], cfg.earnedRange[1])
      const collectedRatio = q === 0 ? 0 : rand(0.6, 0.95)
      const collected = Math.round(earned * collectedRatio * 100) / 100
      const unearned = Math.round((earned - collected) * rand(0.1, 0.4) * 100) / 100
      const isCollected = q > 0 && Math.random() > 0.2

      records.push({
        contractId: cfg.contractId,
        facilityId: cfg.facilityId,
        rebateEarned: earned,
        rebateCollected: collected,
        rebateUnearned: unearned,
        payPeriodStart: quarterStart(q),
        payPeriodEnd: quarterEnd(q),
        collectionDate: isCollected
          ? new Date(now.getFullYear(), now.getMonth() - q * 3 + 4, Math.ceil(Math.random() * 28))
          : null,
        notes: q === 0 ? "Current quarter — pending collection" : null,
      })
    }
  }

  for (const data of records) {
    await prisma.rebate.create({ data })
  }

  console.log(`  Rebates: ${records.length}`)
}
