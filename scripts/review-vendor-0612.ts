/**
 * Vendor-side prod review (2026-06-12, read-only): replays the canonical
 * vendor-facing computations against Railway data — compliance, per-category
 * market share, vendor timeline ownership, My Contracts row data, and
 * pending-submission routes/guards.
 */
import { prisma } from "@/lib/db"
import { computeVendorCompliance } from "@/lib/contracts/vendor-compliance"
import { computeCategoryMarketShare } from "@/lib/contracts/market-share-filter"

async function main() {
  const fac = await prisma.facility.findFirstOrThrow({ where: { name: "Lighthouse Surgical Center" }, select: { id: true, name: true } })
  const vendors = await prisma.vendor.findMany({
    where: { name: { in: ["Arthrex, Inc.", "Stryker"] } },
    select: { id: true, name: true },
  })
  const start = new Date(); start.setFullYear(start.getFullYear() - 1)

  for (const v of vendors) {
    console.log(`\n══ VENDOR: ${v.name} ══`)

    // 1. My Contracts data — active rows + ownership for vendor detail/timeline
    const contracts = await prisma.contract.findMany({
      where: { vendorId: v.id, facilityId: fac.id },
      select: { id: true, name: true, status: true, annualValue: true, totalValue: true, updatedAt: true },
    })
    for (const c of contracts) {
      console.log(`  contract [${c.status}] ${c.name.slice(0, 55)} — lastAction(updatedAt)=${c.updatedAt.toISOString().slice(0, 10)} · vendor timeline ownership: OK (vendorId match by query)`)
    }

    // 2. Vendor compliance (canonical helper, same inputs getVendorPerformance feeds)
    const spendAgg = await prisma.cOGRecord.aggregate({
      where: { facilityId: fac.id, vendorId: v.id, transactionDate: { gte: start } },
      _sum: { extendedPrice: true },
    })
    const spend12Mo = Number(spendAgg._sum.extendedPrice ?? 0)
    const active = contracts.filter((c) => c.status === "active")
    const targets = active.map((c) => Number(c.annualValue ?? c.totalValue ?? 0))
    const compliance = computeVendorCompliance({ spend12Mo, annualTargets: targets })
    console.log(`  compliance: trailing-12mo spend=$${Math.round(spend12Mo).toLocaleString()} ÷ targets [${targets.map((t) => "$" + Math.round(t).toLocaleString()).join(", ")}] → ${compliance === null ? "null (no target)" : compliance + "%"} ${compliance !== null && compliance > 120 ? "❌ EXCEEDS CAP" : "✓ within 0–120 cap"}`)

    // 3. Per-category market share (canonical helper)
    const rows = await prisma.cOGRecord.findMany({
      where: { facilityId: fac.id, transactionDate: { gte: start } },
      select: { vendorId: true, contractId: true, category: true, extendedPrice: true },
    })
    const share = computeCategoryMarketShare({ rows, contractCategoryMap: new Map(), vendorId: v.id })
    const cats = share.rows.filter((c) => c.vendorSpend > 0).sort((a, b) => b.vendorSpend - a.vendorSpend).slice(0, 4)
    for (const cat of cats) {
      console.log(`  market share ${cat.category}: ${cat.sharePct.toFixed(1)}% ($${Math.round(cat.vendorSpend).toLocaleString()} of $${Math.round(cat.categoryTotal).toLocaleString()})`)
    }
    console.log(`  uncategorized vendor spend: $${Math.round(share.uncategorizedSpend).toLocaleString()} of $${Math.round(share.totalVendorSpend).toLocaleString()} total`)
  }

  // 4. Pending submissions: route targets + delete guard parity with the shipped action
  console.log(`\n══ PENDING SUBMISSIONS (route + guard check) ══`)
  const pend = await prisma.pendingContract.findMany({ select: { id: true, status: true, contractName: true, vendor: { select: { name: true } } }, orderBy: { submittedAt: "desc" }, take: 6 })
  for (const p of pend) {
    const deletable = p.status !== "approved"
    console.log(`  [${p.status}] ${p.vendor.name} — ${p.contractName.slice(0, 40)} → route /vendor/contracts/pending/${p.id.slice(0, 8)}…/edit · deletable=${deletable}`)
  }
}
main().finally(() => prisma.$disconnect())
