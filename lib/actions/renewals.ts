"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { addDays } from "date-fns"
import { serialize } from "@/lib/serialize"

export interface ExpiringContract {
  id: string
  name: string
  contractNumber: string | null
  vendorName: string
  vendorId: string
  facilityName: string | null
  facilityId: string | null
  expirationDate: string
  daysUntilExpiry: number
  status: string
  contractType: string
  totalSpend: number
  totalRebate: number
  tierAchieved: number | null
  autoRenewal: boolean
}

export interface RenewalSummary {
  contract: {
    id: string
    name: string
    contractNumber: string | null
    vendorName: string
    effectiveDate: string
    expirationDate: string
    autoRenewal: boolean
  }
  daysUntilExpiry: number
  totalSpend: number
  totalRebate: number
  tierAchieved: number | null
  renewalRecommendation: string
}

// ─── Get Expiring Contracts ──────────────────────────────────────

export async function getExpiringContracts(input: {
  facilityId?: string
  vendorId?: string
  windowDays: number
}): Promise<ExpiringContract[]> {
  await requireAuth()
  const { facilityId, vendorId, windowDays } = input

  const now = new Date()
  const windowEnd = addDays(now, windowDays)

  const contracts = await prisma.contract.findMany({
    where: {
      ...(facilityId ? { facilityId } : {}),
      ...(vendorId ? { vendorId } : {}),
      expirationDate: { gte: now, lte: windowEnd },
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      facility: { select: { id: true, name: true } },
      periods: {
        select: { totalSpend: true, rebateEarned: true, tierAchieved: true },
        orderBy: { periodEnd: "desc" },
        take: 4,
      },
    },
    orderBy: { expirationDate: "asc" },
  })

  return serialize(contracts.map((c) => {
    const totalSpend = c.periods.reduce((sum, p) => sum + Number(p.totalSpend), 0)
    const totalRebate = c.periods.reduce((sum, p) => sum + Number(p.rebateEarned), 0)
    const latestTier = c.periods[0]?.tierAchieved ?? null
    const daysUntilExpiry = Math.ceil(
      (c.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    )

    return {
      id: c.id,
      name: c.name,
      contractNumber: c.contractNumber,
      vendorName: c.vendor.name,
      vendorId: c.vendor.id,
      facilityName: c.facility?.name ?? null,
      facilityId: c.facility?.id ?? null,
      expirationDate: c.expirationDate.toISOString(),
      daysUntilExpiry,
      status: c.status,
      contractType: c.contractType,
      totalSpend,
      totalRebate,
      tierAchieved: latestTier,
      autoRenewal: c.autoRenewal,
    }
  }))
}

// ─── Get Renewal Summary ─────────────────────────────────────────

export async function getRenewalSummary(contractId: string): Promise<RenewalSummary> {
  await requireAuth()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: {
      vendor: { select: { name: true } },
      periods: {
        select: { totalSpend: true, rebateEarned: true, tierAchieved: true },
        orderBy: { periodEnd: "desc" },
      },
    },
  })

  const now = new Date()
  const daysUntilExpiry = Math.ceil(
    (contract.expirationDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  )
  const totalSpend = contract.periods.reduce((s, p) => s + Number(p.totalSpend), 0)
  const totalRebate = contract.periods.reduce((s, p) => s + Number(p.rebateEarned), 0)
  const tierAchieved = contract.periods[0]?.tierAchieved ?? null

  let recommendation = "Review terms and consider renewal."
  if (totalRebate > 0 && tierAchieved && tierAchieved >= 2) {
    recommendation = "Strong performance. Recommend renewal with potential for improved terms."
  } else if (daysUntilExpiry <= 30) {
    recommendation = "Urgent: Contract expiring soon. Initiate renewal immediately."
  }

  return serialize({
    contract: {
      id: contract.id,
      name: contract.name,
      contractNumber: contract.contractNumber,
      vendorName: contract.vendor.name,
      effectiveDate: contract.effectiveDate.toISOString(),
      expirationDate: contract.expirationDate.toISOString(),
      autoRenewal: contract.autoRenewal,
    },
    daysUntilExpiry,
    totalSpend,
    totalRebate,
    tierAchieved,
    renewalRecommendation: recommendation,
  })
}

// ─── Initiate Renewal ────────────────────────────────────────────

export async function initiateRenewal(contractId: string) {
  await requireAuth()

  const original = await prisma.contract.findUniqueOrThrow({
    where: { id: contractId },
    include: { terms: { include: { tiers: true } } },
  })

  const newEffective = new Date(original.expirationDate)
  newEffective.setDate(newEffective.getDate() + 1)
  const newExpiration = addDays(newEffective, 365)

  const renewal = await prisma.contract.create({
    data: {
      name: `${original.name} (Renewal)`,
      contractNumber: original.contractNumber
        ? `${original.contractNumber}-R`
        : null,
      vendorId: original.vendorId,
      facilityId: original.facilityId,
      productCategoryId: original.productCategoryId,
      contractType: original.contractType,
      status: "draft",
      effectiveDate: newEffective,
      expirationDate: newExpiration,
      autoRenewal: original.autoRenewal,
      terminationNoticeDays: original.terminationNoticeDays,
      totalValue: original.totalValue,
      annualValue: original.annualValue,
      description: original.description,
      gpoAffiliation: original.gpoAffiliation,
      performancePeriod: original.performancePeriod,
      rebatePayPeriod: original.rebatePayPeriod,
      isGrouped: original.isGrouped,
      isMultiFacility: original.isMultiFacility,
    },
  })

  // Copy terms + tiers
  for (const term of original.terms) {
    await prisma.contractTerm.create({
      data: {
        contractId: renewal.id,
        termName: term.termName,
        termType: term.termType,
        baselineType: term.baselineType,
        evaluationPeriod: term.evaluationPeriod,
        paymentTiming: term.paymentTiming,
        appliesTo: term.appliesTo,
        effectiveStart: newEffective,
        effectiveEnd: newExpiration,
        volumeType: term.volumeType,
        spendBaseline: term.spendBaseline,
        volumeBaseline: term.volumeBaseline,
        growthBaselinePercent: term.growthBaselinePercent,
        desiredMarketShare: term.desiredMarketShare,
        tiers: {
          create: term.tiers.map((t) => ({
            tierNumber: t.tierNumber,
            spendMin: t.spendMin,
            spendMax: t.spendMax,
            volumeMin: t.volumeMin,
            volumeMax: t.volumeMax,
            marketShareMin: t.marketShareMin,
            marketShareMax: t.marketShareMax,
            rebateType: t.rebateType,
            rebateValue: t.rebateValue,
          })),
        },
      },
    })
  }

  return serialize(renewal)
}
