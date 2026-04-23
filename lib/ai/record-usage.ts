"use server"

/**
 * AI usage recorder — logs one `AIUsageRecord` row per Claude call and
 * debits the owning `AICredit.usedCredits`.
 *
 * The AI Credits tab (`components/facility/settings/tabs/ai-credits-tab.tsx`)
 * reads from these two tables — without this helper, every Claude call is
 * "free" from the tab's perspective and the tab shows zero usage.
 *
 * Contract:
 *  - Call AFTER a successful Claude response. Never block the user-visible
 *    response on this helper (wrap in try/catch, or use streaming onFinish).
 *  - This helper never throws. Usage-logging failures must not regress the
 *    feature; the caller still succeeds. On any error we log via the
 *    CLAUDE.md "AI-action error path" convention and return
 *    `{ recorded: false }`.
 *  - If no `AICredit` row exists for the target entity we lazily create one
 *    with a large default allocation (1,000,000 credits) so the tab always
 *    renders real data. This is a visibility system, not an enforcement
 *    gate — see CLAUDE.md "AI Credits" / Step 1 design.
 */

import { prisma } from "@/lib/db"
import { AI_CREDIT_COSTS, type AIAction } from "@/lib/ai/config"

export interface RecordUsageInput {
  facilityId?: string | null
  vendorId?: string | null
  userId: string
  userName: string
  action: AIAction
  description: string
  quantity?: number
}

export interface RecordUsageResult {
  recorded: boolean
  creditsUsed: number
  remaining: number | null
}

const DEFAULT_MONTHLY_CREDITS = 1_000_000

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

function endOfMonth(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 23, 59, 59, 999),
  )
}

export async function recordClaudeUsage(
  input: RecordUsageInput,
): Promise<RecordUsageResult> {
  const quantity = input.quantity ?? 1
  const creditsUsed = AI_CREDIT_COSTS[input.action] * quantity

  try {
    if (!input.facilityId && !input.vendorId) {
      // Nothing to attribute — still treat as "not recorded" rather than
      // throwing; the caller's response is the priority.
      return { recorded: false, creditsUsed, remaining: null }
    }

    const where = input.facilityId
      ? { facilityId: input.facilityId }
      : { vendorId: input.vendorId as string }

    let credit = await prisma.aICredit.findFirst({
      where,
      orderBy: { billingPeriodEnd: "desc" },
    })

    if (!credit) {
      const now = new Date()
      credit = await prisma.aICredit.create({
        data: {
          facilityId: input.facilityId ?? null,
          vendorId: input.vendorId ?? null,
          // `tierId` is a Prisma enum (`CreditTierId`): starter | professional
          // | enterprise | unlimited. Lazy-provisioned rows go in as
          // `enterprise` so the "Current Plan" card reads sensibly on first
          // render. The allocation below makes this effectively unlimited.
          tierId: "enterprise",
          monthlyCredits: DEFAULT_MONTHLY_CREDITS,
          usedCredits: 0,
          rolloverCredits: 0,
          billingPeriodStart: startOfMonth(now),
          billingPeriodEnd: endOfMonth(now),
        },
      })
    }

    const creditId = credit.id

    const [, updated] = await prisma.$transaction([
      prisma.aIUsageRecord.create({
        data: {
          creditId,
          action: input.action,
          creditsUsed,
          userId: input.userId,
          userName: input.userName,
          description: input.description.slice(0, 300),
        },
      }),
      prisma.aICredit.update({
        where: { id: creditId },
        data: { usedCredits: { increment: creditsUsed } },
      }),
    ])

    const remaining = Math.max(
      0,
      updated.monthlyCredits + updated.rolloverCredits - updated.usedCredits,
    )

    return { recorded: true, creditsUsed, remaining }
  } catch (err) {
    // Per CLAUDE.md "AI-action error path": log the raw exception with the
    // action name + context so prod digests still have a debug trail.
    console.error("[recordClaudeUsage]", err, {
      facilityId: input.facilityId,
      vendorId: input.vendorId,
      userId: input.userId,
      action: input.action,
    })
    return { recorded: false, creditsUsed, remaining: null }
  }
}
