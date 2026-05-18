/**
 * One-off backfill for `Contract.currentMarketShare` + `Contract.complianceRate`.
 *
 * Context: commits 4141a50 (market share) and a66204c (compliance)
 * fixed `computeContractMetrics` to apply the `effectiveCategoryOf`
 * fallback. The per-import auto-refresh (`refreshContractMetricsForVendor`)
 * will repopulate values on the next COG import for any affected
 * vendor, but contracts whose underlying COG hasn't moved keep their
 * stale (artificially low) values until then.
 *
 * This script applies the fixed calc to every active / expiring
 * contract, prints a before / after diff, and writes back when
 * --apply is passed. Mirrors `computeContractMetrics` math inline so
 * it doesn't need a fake auth session.
 *
 * Usage:
 *   bun run scripts/backfill-contract-metrics.ts             # dry-run
 *   bun run scripts/backfill-contract-metrics.ts --apply     # write
 *   bun run scripts/backfill-contract-metrics.ts --facility-id <id>
 */
import { prisma } from "@/lib/db"
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"

const APPLY = process.argv.includes("--apply")
const facilityArgIdx = process.argv.indexOf("--facility-id")
const FACILITY_ID =
  facilityArgIdx >= 0 ? process.argv[facilityArgIdx + 1] : undefined

interface Result {
  contractId: string
  contractName: string
  facilityName: string
  before: { marketShare: number | null; compliance: number | null }
  after: { marketShare: number | null; compliance: number | null }
}

async function computeOne(input: {
  contractId: string
  facilityId: string
  vendorId: string
  categories: string[]
  windowStart: Date
  windowEnd: Date
}): Promise<{ marketShare: number | null; compliance: number | null }> {
  const today = new Date()
  let { windowStart, windowEnd } = input
  if (windowEnd > today) windowEnd = today
  const fiveYearsAgo = new Date(today)
  fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5)
  if (windowStart < fiveYearsAgo) windowStart = fiveYearsAgo

  if (input.categories.length === 0) {
    return { marketShare: null, compliance: null }
  }

  const cogRows = await prisma.cOGRecord.findMany({
    where: {
      facilityId: input.facilityId,
      transactionDate: { gte: windowStart, lte: windowEnd },
    },
    select: {
      vendorId: true,
      category: true,
      extendedPrice: true,
      contractId: true,
      matchStatus: true,
    },
  })

  const contractIds = Array.from(
    new Set(
      cogRows.map((r) => r.contractId).filter((v): v is string => !!v),
    ),
  )
  const contractCategoryRows =
    contractIds.length > 0
      ? await prisma.contract.findMany({
          where: { id: { in: contractIds } },
          select: { id: true, productCategory: { select: { name: true } } },
        })
      : []
  const contractCategoryMap = new Map<string, string | null>(
    contractCategoryRows.map((c) => [c.id, c.productCategory?.name ?? null]),
  )

  const msComputed = computeCategoryMarketShare({
    rows: cogRows,
    contractCategoryMap,
    vendorId: input.vendorId,
  })
  const scopeSet = new Set(input.categories)
  let vendorSpend = 0
  let totalSpend = 0
  for (const row of msComputed.rows) {
    if (!scopeSet.has(row.category)) continue
    vendorSpend += row.vendorSpend
    totalSpend += row.categoryTotal
  }
  const marketShare =
    totalSpend > 0
      ? Math.round((vendorSpend / totalSpend) * 1000) / 10
      : null

  let cogTotal = 0
  let cogOnContract = 0
  for (const row of cogRows) {
    if (row.vendorId !== input.vendorId) continue
    const cat = row.category
      ? row.category
      : row.contractId
        ? contractCategoryMap.get(row.contractId) ?? null
        : null
    if (!cat || !scopeSet.has(cat)) continue
    cogTotal++
    if (row.matchStatus === "on_contract") cogOnContract++
  }
  const compliance =
    cogTotal > 0
      ? Math.round((cogOnContract / cogTotal) * 1000) / 10
      : null

  return { marketShare, compliance }
}

async function main() {
  const contracts = await prisma.contract.findMany({
    where: {
      status: { in: ["active", "expiring"] },
      ...(FACILITY_ID ? { facilityId: FACILITY_ID } : {}),
    },
    select: {
      id: true,
      name: true,
      vendorId: true,
      facilityId: true,
      effectiveDate: true,
      expirationDate: true,
      currentMarketShare: true,
      complianceRate: true,
      productCategory: { select: { name: true } },
      facility: { select: { name: true } },
      terms: { select: { categories: true } },
    },
  })

  console.log(`[backfill-metrics] Inspecting ${contracts.length} contract(s).`)

  const results: Result[] = []
  for (const c of contracts) {
    if (!c.vendorId || !c.facilityId) continue

    const cats = new Set<string>()
    if (c.productCategory?.name) cats.add(c.productCategory.name)
    for (const t of c.terms) {
      for (const cat of t.categories) cats.add(cat)
    }

    const fresh = await computeOne({
      contractId: c.id,
      facilityId: c.facilityId,
      vendorId: c.vendorId,
      categories: Array.from(cats),
      windowStart: c.effectiveDate,
      windowEnd: c.expirationDate,
    })

    const before = {
      marketShare:
        c.currentMarketShare == null ? null : Number(c.currentMarketShare),
      compliance:
        c.complianceRate == null ? null : Number(c.complianceRate),
    }
    const changed =
      before.marketShare !== fresh.marketShare ||
      before.compliance !== fresh.compliance
    if (!changed) continue

    results.push({
      contractId: c.id,
      contractName: c.name,
      facilityName: c.facility?.name ?? "(unknown)",
      before,
      after: fresh,
    })
  }

  if (results.length === 0) {
    console.log("[backfill-metrics] No drift detected.")
    return
  }

  console.log(
    `[backfill-metrics] ${results.length} contract(s) would change:\n`,
  )
  for (const r of results) {
    const ms = `MS ${fmt(r.before.marketShare)}% → ${fmt(r.after.marketShare)}%`
    const cp = `Comp ${fmt(r.before.compliance)}% → ${fmt(r.after.compliance)}%`
    console.log(`  · ${r.facilityName} · ${r.contractName}: ${ms} · ${cp}`)
  }

  if (!APPLY) {
    console.log("\n[backfill-metrics] DRY RUN. Re-run with --apply to write.")
    return
  }

  console.log("\n[backfill-metrics] Applying…")
  let updated = 0
  for (const r of results) {
    await prisma.contract.update({
      where: { id: r.contractId },
      data: {
        currentMarketShare: r.after.marketShare,
        complianceRate: r.after.compliance,
      },
    })
    updated++
  }
  console.log(`[backfill-metrics] Updated ${updated} contract(s).`)
  console.log(
    "[backfill-metrics] Reminder: market_share + compliance_rebate " +
      "rebate accruals key off these fields. Run 'Recompute Earned " +
      "Rebates' on contracts where the value changed.",
  )
}

function fmt(v: number | null): string {
  return v == null ? "—" : v.toFixed(1)
}

main()
  .catch((e) => {
    console.error("[backfill-metrics] FAILED", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
