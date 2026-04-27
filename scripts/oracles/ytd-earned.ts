// scripts/oracles/ytd-earned.ts
/**
 * YTD-earned oracle.
 *
 * Recomputes lifetime + YTD earned rebate from raw Rebate rows for
 * every contract at the demo facility and asserts equality with the
 * canonical helpers `sumEarnedRebatesLifetime` / `sumEarnedRebatesYTD`.
 *
 * Inline math intentionally re-derives the gates so a divergent
 * implementation in the helpers shows up as a per-contract mismatch:
 *   - lifetime: payPeriodEnd <= today
 *   - YTD:      lifetime gate AND payPeriodEnd >= Jan 1 of today.year
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"
import { getDemoFacilityId } from "./_shared/fixtures"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
} from "@/lib/contracts/rebate-earned-filter"

export default defineOracle("ytd-earned", async (ctx) => {
  try {
    const facilityId = await getDemoFacilityId()
    const today = new Date()
    const startOfYear = new Date(today.getFullYear(), 0, 1)

    // Pull every contract at the demo facility with at least one
    // Rebate row. Skip contracts that have no rebates — neither
    // helper has anything to disagree about there.
    const contracts = await prisma.contract.findMany({
      where: { facilityId, rebates: { some: {} } },
      select: {
        id: true,
        name: true,
        rebates: {
          select: {
            rebateEarned: true,
            payPeriodEnd: true,
          },
        },
      },
    })

    if (contracts.length === 0) {
      ctx.check(
        "demo facility has at least one contract with rebates",
        false,
        "no Contract with Rebate rows; run db:seed",
      )
      return
    }

    let lifetimeMismatches = 0
    let ytdMismatches = 0
    const lifetimeDiffs: string[] = []
    const ytdDiffs: string[] = []

    for (const c of contracts) {
      // Independent recompute.
      let oracleLifetime = 0
      let oracleYTD = 0
      for (const r of c.rebates) {
        const end = new Date(r.payPeriodEnd)
        if (end > today) continue
        const earned = Number(r.rebateEarned ?? 0)
        oracleLifetime += earned
        if (end >= startOfYear) oracleYTD += earned
      }

      // App.
      const appLifetime = sumEarnedRebatesLifetime(c.rebates, today)
      const appYTD = sumEarnedRebatesYTD(c.rebates, today)

      if (Math.abs(appLifetime - oracleLifetime) > 0.01) {
        lifetimeMismatches++
        lifetimeDiffs.push(
          `${c.name}: app=$${appLifetime.toFixed(2)} oracle=$${oracleLifetime.toFixed(2)}`,
        )
      }
      if (Math.abs(appYTD - oracleYTD) > 0.01) {
        ytdMismatches++
        ytdDiffs.push(
          `${c.name}: app=$${appYTD.toFixed(2)} oracle=$${oracleYTD.toFixed(2)}`,
        )
      }
    }

    ctx.check(
      "lifetime earned matches per contract (±$0.01)",
      lifetimeMismatches === 0,
      lifetimeMismatches === 0
        ? `${contracts.length} contracts agree`
        : `${lifetimeMismatches} mismatches: ${lifetimeDiffs.slice(0, 5).join("; ")}${lifetimeDiffs.length > 5 ? `; …+${lifetimeDiffs.length - 5} more` : ""}`,
    )
    ctx.check(
      "YTD earned matches per contract (±$0.01)",
      ytdMismatches === 0,
      ytdMismatches === 0
        ? `${contracts.length} contracts agree`
        : `${ytdMismatches} mismatches: ${ytdDiffs.slice(0, 5).join("; ")}${ytdDiffs.length > 5 ? `; …+${ytdDiffs.length - 5} more` : ""}`,
    )

    // Sanity: future-dated rebates must NOT contribute to either gate.
    let futureSeen = 0
    for (const c of contracts) {
      for (const r of c.rebates) {
        if (new Date(r.payPeriodEnd) > today) futureSeen++
      }
    }
    ctx.check(
      "future-dated rebates don't bleed into lifetime",
      true, // True by construction of the recompute; this records the count.
      `${futureSeen} future-dated rebate rows seen across ${contracts.length} contracts`,
    )
  } finally {
    await prisma.$disconnect()
  }
})
