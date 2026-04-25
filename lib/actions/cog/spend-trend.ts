"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { classifySpendTrend } from "@/lib/cog/analytics"

/**
 * Last-6-months monthly spend trend for the facility.
 * Runs the v0-locked classifier and returns both the aggregated
 * series + the up/down/stable verdict so the card can render both.
 */
export async function getCogSpendTrend(_facilityId: string): Promise<{
  monthlySpend: number[]
  /**
   * Charles 2026-04-25 ("these values seem hardcoded"): expose the
   * per-month buckets keyed by YYYY-MM so the card can render the
   * underlying series and prove the aggregate isn't a static widget.
   */
  monthlyBreakdown: Array<{ month: string; spend: number }>
  recordCount: number
  trend: "up" | "down" | "stable"
  changePct: number
  recentAvg: number
  priorAvg: number
}> {
  try {
    const { facility } = await requireFacility()
    const now = new Date()
    // Anchor on the first-of-month 6 full months back so partial-
    // month rows at the edge don't pollute the window.
    const windowStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1),
    )
    const rows = await prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: windowStart, lte: now },
      },
      select: { transactionDate: true, extendedPrice: true },
    })

    // Bucket by YYYY-MM across 6 months ending with the current one.
    const buckets = new Map<string, number>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1),
      )
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      buckets.set(key, 0)
    }
    for (const r of rows) {
      if (!r.transactionDate) continue
      const d = r.transactionDate
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + Number(r.extendedPrice ?? 0))
      }
    }
    const monthlyBreakdown = Array.from(buckets.entries()).map(
      ([month, spend]) => ({ month, spend }),
    )
    const monthlySpend = monthlyBreakdown.map((m) => m.spend)
    const { changePct, trend } = classifySpendTrend(monthlySpend)
    const recent = monthlySpend.slice(-3)
    const prior = monthlySpend.slice(-6, -3)
    const recentAvg =
      recent.length > 0 ? recent.reduce((s, v) => s + v, 0) / recent.length : 0
    const priorAvg =
      prior.length > 0 ? prior.reduce((s, v) => s + v, 0) / prior.length : 0
    return serialize({
      monthlySpend,
      monthlyBreakdown,
      recordCount: rows.length,
      trend,
      changePct,
      recentAvg,
      priorAvg,
    })
  } catch (err) {
    console.error("[getCogSpendTrend]", err)
    throw err
  }
}
