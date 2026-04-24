/**
 * QA walkthrough — acts as a facility user, exercises the key pages
 * by calling the underlying data-fetch functions directly (bypassing
 * requireFacility so we don't need a session). Simulates what Charles
 * would see clicking through his own facility.
 *
 * Reports per surface:
 *   - Data shape + sentinel values
 *   - Any thrown errors caught
 *   - Obvious consistency mismatches between related numbers
 */
import { prisma } from "@/lib/db"
import { sumEarnedRebatesLifetime, sumEarnedRebatesYTD } from "@/lib/contracts/rebate-earned-filter"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { isEvergreen } from "@/lib/contracts/evergreen"

const FINDINGS: { surface: string; level: "OK" | "WARN" | "BUG"; detail: string }[] = []
function note(surface: string, level: "OK" | "WARN" | "BUG", detail: string) {
  FINDINGS.push({ surface, level, detail })
  const icon = level === "OK" ? "✅" : level === "WARN" ? "⚠️ " : "🐛"
  console.log(`  ${icon} ${surface}  —  ${detail}`)
}
const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })

async function main() {
  console.log("# QA walkthrough — Facility user (Lighthouse Surgical Center)")
  console.log()

  const facility = await prisma.facility.findFirstOrThrow({
    where: { name: "Lighthouse Surgical Center" },
  })
  console.log(`Logged in as: demo-facility@tydei.com  →  ${facility.name}  (${facility.id})`)
  console.log()

  // ── Page: Dashboard ──────────────────────────────────────────
  console.log("## /dashboard")
  try {
    const contracts = await prisma.contract.count({ where: { facilityId: facility.id } })
    const cog = await prisma.cOGRecord.count({ where: { facilityId: facility.id } })
    const alerts = await prisma.alert.count({
      where: { facilityId: facility.id, status: "active" },
    }).catch(() => null)
    note("Dashboard counts", "OK", `contracts=${contracts}  cog=${cog.toLocaleString()}  alerts=${alerts ?? "(model missing)"}`)
  } catch (e) {
    note("Dashboard counts", "BUG", `threw: ${(e as Error).message}`)
  }
  console.log()

  // ── Page: Contracts list ──────────────────────────────────────
  console.log("## /dashboard/contracts")
  const contracts = await prisma.contract.findMany({
    where: { facilityId: facility.id },
    include: {
      vendor: true,
      rebates: { select: { rebateEarned: true, rebateCollected: true, payPeriodEnd: true, collectionDate: true } },
      _count: { select: { terms: true, pricingItems: true } },
    },
    take: 10,
  })
  note("Contracts list — row count", contracts.length > 0 ? "OK" : "WARN", `${contracts.length} contracts`)
  const today = new Date()
  for (const c of contracts.slice(0, 5)) {
    const earnedYTD = sumEarnedRebatesYTD(c.rebates, today)
    const collected = sumCollectedRebates(c.rebates)
    const expLabel = isEvergreen(c.expirationDate) ? "Evergreen" : c.expirationDate.toISOString().slice(0, 10)
    const annualGtTotal = Number(c.annualValue) > Number(c.totalValue) + 0.01
    note(
      `  row "${c.name.slice(0, 40)}"`,
      annualGtTotal ? "BUG" : "OK",
      `eff ${c.effectiveDate.toISOString().slice(0, 10)} → ${expLabel}  |  total ${fmt(Number(c.totalValue))}  annual ${fmt(Number(c.annualValue))}  |  terms=${c._count.terms}  pricing=${c._count.pricingItems}  |  earnedYTD ${fmt(earnedYTD)}  collected ${fmt(collected)}${annualGtTotal ? "  ⚠ annual > total" : ""}`,
    )
  }
  console.log()

  // ── Page: Contract detail (pick the most-populated contract) ──
  console.log("## /dashboard/contracts/:id (picking the most-populated)")
  const detailContract = contracts
    .slice()
    .sort(
      (a, b) =>
        b._count.terms + b._count.pricingItems + b.rebates.length -
        (a._count.terms + a._count.pricingItems + a.rebates.length),
    )[0]
  if (!detailContract) {
    note("Contract detail", "WARN", "no contracts to drill into")
  } else {
    console.log(`  Picking: ${detailContract.name} (${detailContract.id})`)
    const full = await prisma.contract.findUniqueOrThrow({
      where: { id: detailContract.id },
      include: {
        terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } } },
        rebates: true,
        periods: true,
      },
    })
    note(
      "Contract detail — terms",
      full.terms.length > 0 ? "OK" : "WARN",
      `${full.terms.length} terms, ${full.terms.reduce((s, t) => s + t.tiers.length, 0)} tiers total`,
    )
    const rebatesEarned = sumEarnedRebatesLifetime(full.rebates, today)
    const closedPeriods = full.rebates.filter((r) => r.payPeriodEnd <= today).length
    note(
      "Contract detail — rebate ledger",
      "OK",
      `${full.rebates.length} Rebate rows, ${closedPeriods} closed, sum earned ${fmt(rebatesEarned)}`,
    )
    const onContract = await prisma.cOGRecord.aggregate({
      where: {
        facilityId: facility.id,
        OR: [{ contractId: full.id }, { contractId: null, vendorId: full.vendorId }],
        matchStatus: { in: ["on_contract", "price_variance"] },
      },
      _count: { _all: true },
      _sum: { extendedPrice: true },
    })
    note(
      "Contract detail — On/Off Contract card",
      onContract._count._all > 0 ? "OK" : "WARN",
      `on-contract rows=${onContract._count._all}  spend=${fmt(Number(onContract._sum.extendedPrice ?? 0))}`,
    )
    // Evergreen sentinel detection check
    if (isEvergreen(full.expirationDate)) {
      note("Contract detail — expiration label", "OK", "sentinel → renders as 'Evergreen'")
    } else {
      const daysToExp = Math.floor((full.expirationDate.getTime() - today.getTime()) / 86_400_000)
      note("Contract detail — expiration label", "OK", `${daysToExp} days until expiration`)
    }
  }
  console.log()

  // ── Page: COG Data ───────────────────────────────────────────
  console.log("## /dashboard/cog")
  const cogStats = await prisma.cOGRecord.groupBy({
    by: ["matchStatus"],
    where: { facilityId: facility.id },
    _count: { _all: true },
    _sum: { extendedPrice: true },
  })
  let total = 0
  let onC = 0
  for (const s of cogStats) {
    const c = s._count._all
    const sp = Number(s._sum.extendedPrice ?? 0)
    total += c
    if (s.matchStatus === "on_contract" || s.matchStatus === "price_variance") onC += c
    console.log(`      ${s.matchStatus}: ${c.toLocaleString()} rows, ${fmt(sp)}`)
  }
  note(
    "COG enrichment overview",
    total > 0 && onC / total > 0.05 ? "OK" : "WARN",
    `total=${total.toLocaleString()} rows  on-contract=${onC.toLocaleString()} (${((onC / Math.max(1, total)) * 100).toFixed(1)}%)`,
  )
  // Data-integrity check: any COG rows with null vendorItemNo?
  const nullVendorItemNo = await prisma.cOGRecord.count({
    where: { facilityId: facility.id, vendorItemNo: null },
  })
  if (nullVendorItemNo > 0) {
    note(
      "COG data integrity",
      nullVendorItemNo / Math.max(1, total) > 0.5 ? "BUG" : "WARN",
      `${nullVendorItemNo.toLocaleString()} rows lack vendorItemNo — cannot match pricing`,
    )
  } else {
    note("COG data integrity", "OK", "all rows have vendorItemNo")
  }
  console.log()

  // ── Page: Renewals ───────────────────────────────────────────
  console.log("## /dashboard/renewals")
  const expiringSoon = await prisma.contract.findMany({
    where: {
      facilityId: facility.id,
      status: { in: ["active", "expiring"] },
      // exclude evergreen sentinel
      expirationDate: { lt: new Date(Date.UTC(9000, 0, 1)) },
    },
    orderBy: { expirationDate: "asc" },
    take: 5,
  })
  note(
    "Renewals page",
    "OK",
    `${expiringSoon.length} contracts upcoming (evergreen excluded)`,
  )
  for (const c of expiringSoon) {
    const days = Math.floor((c.expirationDate.getTime() - today.getTime()) / 86_400_000)
    console.log(`      ${c.name.slice(0, 50)}  expires in ${days} days`)
  }
  console.log()

  // ── Summary ─────────────────────────────────────────────────
  console.log("━".repeat(60))
  const bugs = FINDINGS.filter((f) => f.level === "BUG")
  const warns = FINDINGS.filter((f) => f.level === "WARN")
  const oks = FINDINGS.filter((f) => f.level === "OK")
  console.log(`Findings: ${oks.length} OK, ${warns.length} WARN, ${bugs.length} BUG`)
  if (bugs.length > 0) {
    console.log("\n🐛 Bugs:")
    for (const f of bugs) console.log(`  ${f.surface} — ${f.detail}`)
  }
  if (warns.length > 0) {
    console.log("\n⚠️  Warnings:")
    for (const f of warns) console.log(`  ${f.surface} — ${f.detail}`)
  }

  await prisma.$disconnect()
  process.exit(bugs.length > 0 ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
