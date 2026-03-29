"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { AI_CREDIT_COSTS, type AIAction } from "@/lib/ai/config"

// ─── Types ──────────────────────────────────────────────────────

export interface AICredit {
  id: string
  tierId: string
  monthlyCredits: number
  usedCredits: number
  rolloverCredits: number
  remaining: number
  billingPeriodStart: string
  billingPeriodEnd: string
}

export interface AIUsageRecord {
  id: string
  action: string
  creditsUsed: number
  userName: string
  description: string
  createdAt: string
}

// ─── Get Credits ────────────────────────────────────────────────

export async function getAICredits(input: {
  facilityId?: string
  vendorId?: string
}): Promise<AICredit | null> {
  await requireAuth()

  const credit = await prisma.aICredit.findFirst({
    where: input.facilityId
      ? { facilityId: input.facilityId }
      : { vendorId: input.vendorId },
    orderBy: { billingPeriodEnd: "desc" },
  })

  if (!credit) return null

  const remaining =
    credit.monthlyCredits + credit.rolloverCredits - credit.usedCredits

  return {
    id: credit.id,
    tierId: credit.tierId,
    monthlyCredits: credit.monthlyCredits,
    usedCredits: credit.usedCredits,
    rolloverCredits: credit.rolloverCredits,
    remaining: Math.max(0, remaining),
    billingPeriodStart: credit.billingPeriodStart.toISOString().slice(0, 10),
    billingPeriodEnd: credit.billingPeriodEnd.toISOString().slice(0, 10),
  }
}

// ─── Use Credits ────────────────────────────────────────────────

export async function useAICredits(input: {
  creditId: string
  action: string
  creditsUsed: number
  userId: string
  userName: string
  description: string
}): Promise<{ success: boolean; remaining: number }> {
  await requireAuth()

  const credit = await prisma.aICredit.findUniqueOrThrow({
    where: { id: input.creditId },
  })

  const available =
    credit.monthlyCredits + credit.rolloverCredits - credit.usedCredits

  if (available < input.creditsUsed) {
    return { success: false, remaining: Math.max(0, available) }
  }

  await prisma.$transaction([
    prisma.aICredit.update({
      where: { id: input.creditId },
      data: { usedCredits: { increment: input.creditsUsed } },
    }),
    prisma.aIUsageRecord.create({
      data: {
        creditId: input.creditId,
        action: input.action,
        creditsUsed: input.creditsUsed,
        userId: input.userId,
        userName: input.userName,
        description: input.description,
      },
    }),
  ])

  return {
    success: true,
    remaining: Math.max(0, available - input.creditsUsed),
  }
}

// ─── Usage History ──────────────────────────────────────────────

export async function getAIUsageHistory(
  creditId: string
): Promise<AIUsageRecord[]> {
  await requireAuth()

  const records = await prisma.aIUsageRecord.findMany({
    where: { creditId },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  return records.map((r) => ({
    id: r.id,
    action: r.action,
    creditsUsed: r.creditsUsed,
    userName: r.userName,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  }))
}

// ─── Check Credits ──────────────────────────────────────────────

export async function checkAICredits(input: {
  facilityId?: string
  vendorId?: string
  action: AIAction
  quantity?: number
}): Promise<{ available: boolean; cost: number; remaining: number }> {
  await requireAuth()

  const cost = AI_CREDIT_COSTS[input.action] * (input.quantity ?? 1)
  const credit = await getAICredits({
    facilityId: input.facilityId,
    vendorId: input.vendorId,
  })

  if (!credit) {
    return { available: false, cost, remaining: 0 }
  }

  return {
    available: credit.remaining >= cost,
    cost,
    remaining: credit.remaining,
  }
}
