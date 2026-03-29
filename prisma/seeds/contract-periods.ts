import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Contracts } from "./contracts"

const now = new Date()

function monthStart(monthsAgo: number) {
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1)
}

function monthEnd(monthsAgo: number) {
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo + 1, 0)
}

function rand(min: number, max: number) {
  return Math.round((Math.random() * (max - min) + min) * 100) / 100
}

type ContractConfig = {
  contractId: string
  facilityId: string
  spendRange: [number, number]
  volumeRange: [number, number]
  rebateRate: [number, number]
}

export async function seedContractPeriods(
  prisma: PrismaClient,
  deps: { contracts: Contracts; facilities: Facilities }
) {
  const { contracts: c, facilities: f } = deps

  const configs: ContractConfig[] = [
    { contractId: c.strykerJoint.id, facilityId: f.lighthouseSurgical.id, spendRange: [80000, 140000], volumeRange: [60, 120], rebateRate: [0.02, 0.06] },
    { contractId: c.medtronicSpine.id, facilityId: f.lighthouseCommunity.id, spendRange: [50000, 100000], volumeRange: [80, 200], rebateRate: [0.02, 0.05] },
    { contractId: c.snSports.id, facilityId: f.lighthouseSurgical.id, spendRange: [25000, 45000], volumeRange: [50, 100], rebateRate: [0.01, 0.05] },
    { contractId: c.arthrexLighthouse.id, facilityId: f.lighthouseSurgical.id, spendRange: [20000, 35000], volumeRange: [40, 80], rebateRate: [0.015, 0.05] },
    { contractId: c.depuyTrauma.id, facilityId: f.summitGeneral.id, spendRange: [35000, 65000], volumeRange: [70, 150], rebateRate: [0.02, 0.05] },
    { contractId: c.zbKnee.id, facilityId: f.heritageRegional.id, spendRange: [50000, 90000], volumeRange: [50, 110], rebateRate: [0.02, 0.06] },
    { contractId: c.integraDural.id, facilityId: f.lighthouseCommunity.id, spendRange: [8000, 15000], volumeRange: [30, 70], rebateRate: [0.02, 0.04] },
    { contractId: c.medtronicBio.id, facilityId: f.heritageRegional.id, spendRange: [18000, 30000], volumeRange: [40, 90], rebateRate: [0.02, 0.04] },
    { contractId: c.hologicMammo.id, facilityId: f.heritageRegional.id, spendRange: [5000, 8000], volumeRange: [50, 150], rebateRate: [0.02, 0.03] },
    { contractId: c.strykerPricing.id, facilityId: f.lighthouseCommunity.id, spendRange: [10000, 20000], volumeRange: [30, 60], rebateRate: [0.01, 0.02] },
  ]

  const records: Parameters<typeof prisma.contractPeriod.create>[0]["data"][] = []

  for (const cfg of configs) {
    for (let m = 11; m >= 0; m--) {
      const spend = rand(cfg.spendRange[0], cfg.spendRange[1])
      const volume = Math.round(rand(cfg.volumeRange[0], cfg.volumeRange[1]))
      const rate = rand(cfg.rebateRate[0], cfg.rebateRate[1])
      const earned = Math.round(spend * rate * 100) / 100
      const collectedRatio = rand(0.6, 0.9)
      const collected = Math.round(earned * collectedRatio * 100) / 100
      const paymentExpected = spend
      const paymentActual = Math.round(spend * rand(0.92, 1.02) * 100) / 100

      records.push({
        contractId: cfg.contractId,
        facilityId: cfg.facilityId,
        periodStart: monthStart(m),
        periodEnd: monthEnd(m),
        totalSpend: spend,
        totalVolume: volume,
        rebateEarned: earned,
        rebateCollected: collected,
        paymentExpected: paymentExpected,
        paymentActual: paymentActual,
        balanceExpected: Math.round((paymentExpected - paymentActual) * 100) / 100,
        balanceActual: Math.round((paymentExpected - paymentActual + earned - collected) * 100) / 100,
        tierAchieved: Math.ceil(Math.random() * 3),
      })
    }
  }

  for (const data of records) {
    await prisma.contractPeriod.create({ data })
  }

  console.log(`  Contract Periods: ${records.length}`)
}
