/**
 * Verify the 2026-06-13 fixes against PROD (Railway) — read-only.
 * Uses the SHIPPED canonical helpers directly.
 */
import { prisma } from "@/lib/db"
import { normalizeVolumeTiers, selectAchievedVolumeTier } from "@/lib/contracts/recompute/volume"
import { computePerPeriodMarketShare, buildThresholdEvaluationWindows } from "@/lib/contracts/recompute/threshold"

const ID = "cmqbcw4wd00040ypgudy9modb"
async function main() {
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: ID }, include: { terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } } } } })
  const term = c.terms.find((t) => t.termType === "volume_rebate")!
  const tiers = normalizeVolumeTiers(term.tiers)

  console.log("── Fix V: displayed tier/rate from UNITS (was: dollar walk showed $7) ──")
  const cog = await prisma.cOGRecord.findMany({ where: { facilityId: c.facilityId, vendorId: c.vendorId!, transactionDate: { gte: c.effectiveDate, lte: new Date() } }, select: { transactionDate: true, quantity: true } })
  for (const year of [2024, 2025, 2026]) {
    const units = cog.filter((r) => r.transactionDate.getUTCFullYear() === year).reduce((s, r) => s + (r.quantity ?? 0), 0)
    const t = selectAchievedVolumeTier(tiers, units)
    console.log(`  ${year}: window units=${units} → DISPLAY tier ${t?.tierNumber} · $${t?.rebateValue}/unit · accrual $${(units * (t?.rebateValue ?? 0)).toLocaleString()}`)
  }

  console.log("\n── Fix M: per-period market share via the shipped helper (multi-category union) ──")
  const windows = buildThresholdEvaluationWindows({
    contractEffectiveDate: c.effectiveDate, contractExpirationDate: c.expirationDate,
    termEffectiveStart: null, termEffectiveEnd: null, evaluationPeriod: "annual",
  })
  const shares = await computePerPeriodMarketShare({
    facilityId: c.facilityId, vendorIds: [c.vendorId!],
    scopedCategoryNames: ["Ortho-Sports Med", "Ortho-Extremity"],
    windows: windows.windows.concat(windows.openTail ? [windows.openTail] : []),
    queryStart: c.effectiveDate, queryEnd: new Date(),
  })
  windows.windows.concat(windows.openTail ? [windows.openTail] : []).forEach((w, i) => {
    const s = shares[i]!
    console.log(`  ${w.periodStart.toISOString().slice(0,10)}..${w.periodEnd.toISOString().slice(0,10)}: share=${s.share.toFixed(1)}% (vendor $${Math.round(s.vendorSpend).toLocaleString()} ÷ market $${Math.round(s.marketSpend).toLocaleString()}) → 7%@90 tier would pay $${Math.round(s.share >= 90 ? s.vendorSpend * 0.07 : 0).toLocaleString()}`)
  })
}
main().finally(() => prisma.$disconnect())
