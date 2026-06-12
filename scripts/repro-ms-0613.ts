/**
 * Read-only replication of recomputeThresholdAccrualForTerm's per-period
 * market-share path against Railway, for the multi-category 7% scenario
 * Charles described (bugs.rtfd 2026-06-13). No writes.
 */
import { prisma } from "@/lib/db"
import { determineTier } from "@/lib/rebates/engine/shared/determine-tier"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { expandCategoriesToCogVariants } from "@/lib/contracts/cog-category-filter"

const CONTRACT = "cmqbcw4wd00040ypgudy9modb"
async function main() {
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: CONTRACT }, select: { facilityId: true, vendorId: true, effectiveDate: true, expirationDate: true, currentMarketShare: true } })
  console.log(`contract.currentMarketShare (persisted scalar) = ${c.currentMarketShare}`)

  // Term as the editor would create it: market_share, annual, 2 categories,
  // single tier 90%+ → 7% of in-scope spend (percent threshold in spendMin,
  // rebateValue fraction 0.07, percent_of_spend).
  const categories = ["Ortho-Sports Med", "Ortho-Extremity"]
  const tiersRaw = [{ tierNumber: 1, spendMin: 90, spendMax: null, rebateValue: 0.07, rebateType: "percent_of_spend" }]

  const universe = await facilityCogCategoryUniverse(c.facilityId)
  const expanded = expandCategoriesToCogVariants(categories, universe)
  console.log(`category union expands to ${expanded.length} COG variants`)

  const start = c.effectiveDate, end = new Date()
  const vendorIdSet = [c.vendorId!]
  const [vendorRows, facilityRows] = await Promise.all([
    prisma.cOGRecord.findMany({ where: { facilityId: c.facilityId, vendorId: { in: vendorIdSet }, transactionDate: { gte: start, lte: end }, category: { in: expanded } }, select: { transactionDate: true, extendedPrice: true } }),
    prisma.cOGRecord.findMany({ where: { facilityId: c.facilityId, transactionDate: { gte: start, lte: end }, category: { in: expanded } }, select: { transactionDate: true, extendedPrice: true } }),
  ])
  // annual windows 2024 / 2025 / 2026-to-date
  for (const [ps, pe] of [["2024-01-01","2024-12-31"],["2025-01-01","2025-12-31"],["2026-01-01","2026-12-31"]] as const) {
    const s = new Date(ps + "T00:00:00Z").getTime(), e = new Date(pe + "T23:59:59Z").getTime()
    const sum = (rows: typeof vendorRows) => rows.reduce((a, r) => { const t = r.transactionDate.getTime(); return t >= s && t <= e ? a + Number(r.extendedPrice ?? 0) : a }, 0)
    const v = sum(vendorRows), f = sum(facilityRows)
    const share = f > 0 ? (v / f) * 100 : 0
    // tier bridge: percent threshold lives in spendMin; determineTier compares share vs threshold
    // writer bridge: spendMin → thresholdMin (percent points)
    const tiers = tiersRaw.map((t) => ({ tierNumber: t.tierNumber, tierName: null, thresholdMin: Number(t.spendMin ?? 0), thresholdMax: t.spendMax == null ? null : Number(t.spendMax), rebateValue: t.rebateValue * 100 }))
    const achieved = determineTier(share, tiers as never, "EXCLUSIVE")
    const payment = achieved ? v * tiersRaw[0]!.rebateValue : 0
    console.log(`${ps.slice(0,4)}: vendor=$${Math.round(v).toLocaleString()} market=$${Math.round(f).toLocaleString()} share=${share.toFixed(1)}% tier=${achieved?.tierNumber ?? 0} → payment=$${Math.round(payment).toLocaleString()}`)
  }
  // ALSO: what the single-category version computes (per-category shares) for comparison
  for (const cat of categories) {
    const exp1 = expandCategoriesToCogVariants([cat], universe)
    const [v1, f1] = await Promise.all([
      prisma.cOGRecord.aggregate({ where: { facilityId: c.facilityId, vendorId: { in: vendorIdSet }, transactionDate: { gte: start, lte: end }, category: { in: exp1 } }, _sum: { extendedPrice: true } }),
      prisma.cOGRecord.aggregate({ where: { facilityId: c.facilityId, transactionDate: { gte: start, lte: end }, category: { in: exp1 } }, _sum: { extendedPrice: true } }),
    ])
    const share = Number(f1._sum.extendedPrice ?? 0) > 0 ? (Number(v1._sum.extendedPrice ?? 0) / Number(f1._sum.extendedPrice ?? 0)) * 100 : 0
    console.log(`  single-category ${cat}: ${share.toFixed(1)}%`)
  }
}
main().finally(() => prisma.$disconnect())
