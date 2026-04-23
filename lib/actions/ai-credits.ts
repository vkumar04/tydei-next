"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { AI_CREDIT_COSTS, type AIAction } from "@/lib/ai/config"
import { serialize } from "@/lib/serialize"

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

const DEFAULT_MONTHLY_CREDITS = 1_000_000

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function endOfMonth(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  )
}

export async function getAICredits(input: {
  facilityId?: string
  vendorId?: string
}): Promise<AICredit | null> {
  await requireAuth()

  if (!input.facilityId && !input.vendorId) return null

  const where = input.facilityId
    ? { facilityId: input.facilityId }
    : { vendorId: input.vendorId as string }

  let credit = await prisma.aICredit.findFirst({
    where,
    orderBy: { billingPeriodEnd: "desc" },
  })

  // Lazy-provision a default Enterprise-tier row on first read so the AI
  // Credits tab shows real numbers (not "Unlimited" placeholder) even
  // before the facility's first Claude call. Mirrors the provisioning in
  // lib/ai/record-usage.ts — either side can be the first to create it.
  if (!credit) {
    const now = new Date()
    credit = await prisma.aICredit.create({
      data: {
        facilityId: input.facilityId ?? null,
        vendorId: input.vendorId ?? null,
        tierId: "enterprise",
        monthlyCredits: DEFAULT_MONTHLY_CREDITS,
        usedCredits: 0,
        rolloverCredits: 0,
        billingPeriodStart: startOfMonth(now),
        billingPeriodEnd: endOfMonth(now),
      },
    })
  }

  const remaining =
    credit.monthlyCredits + credit.rolloverCredits - credit.usedCredits

  return serialize({
    id: credit.id,
    tierId: credit.tierId,
    monthlyCredits: credit.monthlyCredits,
    usedCredits: credit.usedCredits,
    rolloverCredits: credit.rolloverCredits,
    remaining: Math.max(0, remaining),
    billingPeriodStart: credit.billingPeriodStart.toISOString().slice(0, 10),
    billingPeriodEnd: credit.billingPeriodEnd.toISOString().slice(0, 10),
  })
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

  return serialize(records.map((r) => ({
    id: r.id,
    action: r.action,
    creditsUsed: r.creditsUsed,
    userName: r.userName,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  })))
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
