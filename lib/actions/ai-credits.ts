"use server"

import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
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

// 2026-06-09 audit BLOCKER: every action in this file previously took
// tenant ids / creditIds from CLIENT input with only requireAuth — any
// authenticated user could read, lazily CREATE, and burn another
// tenant's AI credits. Tenant scope now derives from the session member
// (same pattern as getUnreadAlertCount round-10); creditId-based reads
// verify the row belongs to the session tenant.
async function sessionTenant(): Promise<{
  userId: string
  userName: string
  facilityId: string | null
  vendorId: string | null
}> {
  const session = await requireAuth()
  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true, vendor: true } } },
  })
  return {
    userId: session.user.id,
    userName: session.user.name ?? session.user.email ?? "Unknown",
    facilityId: member?.organization?.facility?.id ?? null,
    vendorId: member?.organization?.vendor?.id ?? null,
  }
}

/** Throws unless the credit row belongs to the session's tenant. */
async function requireOwnedCredit(creditId: string) {
  const tenant = await sessionTenant()
  // auth-scope-scanner-skip: post-fetch equality check — the row is
  // fetched by id, then verified against the session tenant below.
  const credit = await prisma.aICredit.findUniqueOrThrow({
    where: { id: creditId },
  })
  const owned =
    (credit.facilityId !== null && credit.facilityId === tenant.facilityId) ||
    (credit.vendorId !== null && credit.vendorId === tenant.vendorId)
  if (!owned) {
    throw new Error("Credit account not found for this organization")
  }
  return { credit, tenant }
}

export async function getAICredits(_input?: {
  /** @deprecated 2026-06-09 audit: ignored — derived from session. */
  facilityId?: string
  /** @deprecated 2026-06-09 audit: ignored — derived from session. */
  vendorId?: string
}): Promise<AICredit | null> {
  const tenant = await sessionTenant()
  if (!tenant.facilityId && !tenant.vendorId) return null

  const where = tenant.facilityId
    ? { facilityId: tenant.facilityId }
    : { vendorId: tenant.vendorId as string }

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
    // read-only-guard-skip: lazy-provisions the caller's OWN default
    // Enterprise-tier credit row on first read so the AI Credits tab shows
    // real numbers — a read-shaped, idempotent action (mirrors
    // lib/ai/record-usage.ts), not a tenant mutation the read-only tier governs.
    credit = await prisma.aICredit.create({
      data: {
        facilityId: tenant.facilityId,
        vendorId: tenant.facilityId ? null : tenant.vendorId,
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
  /** @deprecated 2026-06-09 audit: ignored — identity comes from session. */
  userId?: string
  /** @deprecated 2026-06-09 audit: ignored — identity comes from session. */
  userName?: string
  description: string
}): Promise<{ success: boolean; remaining: number }> {
  // 2026-06-09 settings audit: a NEGATIVE creditsUsed passed the
  // `available < creditsUsed` check and then `increment`ed usedCredits
  // by a negative number — i.e. self-served credit refunds. Reject
  // non-positive / non-integer amounts up front.
  if (!Number.isInteger(input.creditsUsed) || input.creditsUsed <= 0) {
    throw new Error("creditsUsed must be a positive integer")
  }

  // Ownership + session identity — pre-fix anyone could burn another
  // tenant's credits and attribute usage to an arbitrary userId/userName.
  const { credit, tenant } = await requireOwnedCredit(input.creditId)
  await requireCanMutate()

  const available =
    credit.monthlyCredits + credit.rolloverCredits - credit.usedCredits

  if (available < input.creditsUsed) {
    return { success: false, remaining: Math.max(0, available) }
  }

  await prisma.$transaction([
    // auth-scope-scanner-skip: pre-authorized — requireOwnedCredit above
    // verified this creditId belongs to the session tenant.
    prisma.aICredit.update({
      where: { id: input.creditId },
      data: { usedCredits: { increment: input.creditsUsed } },
    }),
    prisma.aIUsageRecord.create({
      data: {
        creditId: input.creditId,
        action: input.action,
        creditsUsed: input.creditsUsed,
        userId: tenant.userId,
        userName: tenant.userName,
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
  await requireOwnedCredit(creditId)

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

// ─── Usage Breakdown by Action ──────────────────────────────────

export interface AIUsageBreakdown {
  action: string
  totalCredits: number
  callCount: number
  lastUsedAt: string
}

/**
 * Per-action rollup over the credit row's billing period. Used by
 * the AI Usage card on /dashboard/settings to show which actions
 * are eating the credit budget. Sorted by total credits descending
 * so the biggest spenders bubble to the top.
 */
export async function getAIUsageBreakdown(
  creditId: string,
): Promise<AIUsageBreakdown[]> {
  await requireOwnedCredit(creditId)

  const grouped = await prisma.aIUsageRecord.groupBy({
    by: ["action"],
    where: { creditId },
    _sum: { creditsUsed: true },
    _count: { _all: true },
    _max: { createdAt: true },
  })

  return serialize(
    grouped
      .map((g) => ({
        action: g.action,
        totalCredits: g._sum.creditsUsed ?? 0,
        callCount: g._count._all,
        lastUsedAt: g._max.createdAt?.toISOString() ?? new Date(0).toISOString(),
      }))
      .sort((a, b) => b.totalCredits - a.totalCredits),
  )
}

// ─── Check Credits ──────────────────────────────────────────────

export async function checkAICredits(input: {
  /** @deprecated 2026-06-09 audit: ignored — derived from session. */
  facilityId?: string
  /** @deprecated 2026-06-09 audit: ignored — derived from session. */
  vendorId?: string
  action: AIAction
  quantity?: number
}): Promise<{ available: boolean; cost: number; remaining: number }> {
  const cost = AI_CREDIT_COSTS[input.action] * (input.quantity ?? 1)
  // Session-scoped — getAICredits ignores client ids now.
  const credit = await getAICredits()

  if (!credit) {
    return { available: false, cost, remaining: 0 }
  }

  return {
    available: credit.remaining >= cost,
    cost,
    remaining: credit.remaining,
  }
}
