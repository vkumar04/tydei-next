/**
 * Manual end-to-end review of the 2026-06-12 fixes against PROD (Railway).
 * Read-only. Replays the deployed code's math using the SAME exported
 * helpers the app uses, then compares to persisted writer rows.
 */
import { prisma } from "@/lib/db"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import {
  normalizeVolumeTiers,
  selectAchievedVolumeTier,
  computeVolumeTierRebate,
  currentOpenVolumeWindow,
} from "@/lib/contracts/recompute/volume"

const VOL_ID = "cmqapry6d0mjh0ys67dvl949r"   // Arthrex volume contract
const CARVE_ID = "cmqapnjzh00070ys6oarna4nc" // Stryker Mako tie-in

function mkey(d: Date) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` }

async function reviewVolume() {
  console.log("\n══ 1. VOLUME CONTRACT (Arthrex) ══")
  const c = await prisma.contract.findUniqueOrThrow({
    where: { id: VOL_ID },
    include: { terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } } } },
  })
  const term = c.terms[0]!
  const vendorIds = contractVendorIds(c)
  console.log(`vendor set: ${vendorIds.length} id(s); term eval=${term.evaluationPeriod} appliesTo=${term.appliesTo}`)
  const cog = await prisma.cOGRecord.findMany({
    where: { facilityId: c.facilityId, vendorId: { in: vendorIds }, transactionDate: { gte: c.effectiveDate, lte: new Date() } },
    select: { transactionDate: true, quantity: true },
  })
  const unitsByYear = new Map<number, number>()
  const unitsByMonth = new Map<string, number>()
  for (const r of cog) {
    const y = r.transactionDate.getUTCFullYear()
    unitsByYear.set(y, (unitsByYear.get(y) ?? 0) + (r.quantity ?? 0))
    unitsByMonth.set(mkey(r.transactionDate), (unitsByMonth.get(mkey(r.transactionDate)) ?? 0) + (r.quantity ?? 0))
  }
  const tiers = normalizeVolumeTiers(term.tiers)
  for (const [y, units] of [...unitsByYear].sort()) {
    const { achieved, rebateEarned } = computeVolumeTierRebate(tiers, units, 0)
    console.log(`  ${y}: COG units=${units} → engine rebate=$${rebateEarned.toFixed(2)} (tier ${achieved?.tierNumber ?? "—"})`)
  }
  const persisted = await prisma.rebate.findMany({ where: { contractId: VOL_ID, notes: { contains: "-accrual]" } }, select: { rebateEarned: true, payPeriodStart: true, notes: true }, orderBy: { payPeriodStart: "asc" } })
  for (const r of persisted) console.log(`  persisted ${r.payPeriodStart?.toISOString().slice(0,4)}: $${r.rebateEarned} :: ${(r.notes ?? "").slice(0, 70)}`)
  // F2: open-window in-progress display
  const win = currentOpenVolumeWindow({ contractEffectiveDate: c.effectiveDate, contractExpirationDate: c.expirationDate, effectiveStart: term.effectiveStart, effectiveEnd: term.effectiveEnd, evaluationPeriod: term.evaluationPeriod })
  if (win) {
    let unitsInWin = 0
    for (const [m, u] of unitsByMonth) { const d = new Date(`${m}-15T00:00:00Z`); if (d >= win.windowStart && d <= win.windowEnd) unitsInWin += u }
    const { rebateEarned: inProg } = computeVolumeTierRebate(tiers, unitsInWin, 0)
    console.log(`  F2 open window ${win.windowStart.toISOString().slice(0,10)}..${win.windowEnd.toISOString().slice(0,10)}: units-to-date=${unitsInWin} → in-progress display accrual=$${inProg.toFixed(2)}`)
  } else console.log("  F2: no open window (term expired)")
}

async function reviewCarveOut() {
  console.log("\n══ 2. CARVE-OUT TIE-IN (Stryker Mako) ══")
  const c = await prisma.contract.findUniqueOrThrow({ where: { id: CARVE_ID }, include: { terms: true } })
  const vendorIds = contractVendorIds(c)
  const carved = await prisma.contractPricing.findMany({ where: { contractId: CARVE_ID, carveOutPercent: { not: null } }, select: { vendorItemNo: true } })
  const skuSet = new Set(carved.map((p) => normalizeSku(p.vendorItemNo)))
  console.log(`carved pricing lines: ${carved.length}; distinct SKUs: ${skuSet.size}`)
  const cog = await prisma.cOGRecord.findMany({
    where: { facilityId: c.facilityId, transactionDate: { gte: c.effectiveDate, lte: new Date() },
      OR: [{ contractId: CARVE_ID }, { vendorId: { in: vendorIds } }],
      matchStatus: { in: ["on_contract", "price_variance"] } },
    select: { transactionDate: true, extendedPrice: true, vendorItemNo: true },
  })
  const spendByMonth = new Map<string, number>()
  for (const r of cog) {
    if (!skuSet.has(normalizeSku(r.vendorItemNo))) continue
    spendByMonth.set(mkey(r.transactionDate), (spendByMonth.get(mkey(r.transactionDate)) ?? 0) + Number(r.extendedPrice ?? 0))
  }
  const months = [...spendByMonth].sort()
  console.log(`R3 spend series: ${months.length} months with carved-SKU spend (was: 0 everywhere)`)
  console.log(`  first: ${months[0]?.[0]} $${months[0]?.[1].toFixed(0)} · last: ${months.at(-1)?.[0]} $${months.at(-1)?.[1].toFixed(0)}`)
  // semi-annual sums vs persisted
  const halfSum = (from: string, to: string) => months.filter(([m]) => m >= from && m <= to).reduce((s, [, v]) => s + v, 0)
  console.log(`  2024-H1 spend=$${halfSum("2024-01","2024-06").toFixed(0)}  2024-H2=$${halfSum("2024-07","2024-12").toFixed(0)}  2025-H1=$${halfSum("2025-01","2025-06").toFixed(0)}  2025-H2=$${halfSum("2025-07","2025-12").toFixed(0)}`)
  const persisted = await prisma.rebate.findMany({ where: { contractId: CARVE_ID, notes: { startsWith: "[auto-carve-out-accrual]" } }, select: { rebateEarned: true, payPeriodEnd: true }, orderBy: { payPeriodEnd: "asc" } })
  for (const r of persisted) console.log(`  persisted overlay ${r.payPeriodEnd?.toISOString().slice(0,10)}: $${r.rebateEarned}`)
}

async function reviewVendorSide() {
  console.log("\n══ 3. VENDOR SIDE ══")
  // getVendorAccrualTimeline ownership gate: contract.vendorId must equal the vendor's id
  const stryker = await prisma.contract.findUnique({ where: { id: CARVE_ID }, select: { vendorId: true, vendor: { select: { name: true } } } })
  console.log(`tie-in ownership: vendorId=${stryker?.vendorId ? "set (" + stryker?.vendor?.name + ")" : "NULL — vendor detail would 404"}`)
  // Vendor My Contracts: pending rows + Last Action resolution + deletable set
  const pending = await prisma.pendingContract.findMany({ select: { status: true, submittedAt: true, reviewedAt: true, vendor: { select: { name: true } }, contractName: true }, orderBy: { submittedAt: "desc" }, take: 10 })
  console.log(`pendingContract rows: ${pending.length}`)
  for (const p of pending) {
    const lastAction = (p.reviewedAt ?? p.submittedAt)?.toISOString().slice(0, 10)
    const deletable = p.status !== "approved"
    console.log(`  [${p.status}] ${p.contractName.slice(0, 50)} — lastAction=${lastAction} deletable=${deletable}`)
  }
}

async function reviewProposalJoin() {
  console.log("\n══ 4. PROPOSAL ANALYZER VENDOR JOIN ══")
  const fac = await prisma.facility.findFirstOrThrow({ where: { name: "Lighthouse Surgical Center" }, select: { id: true } })
  const sample = await prisma.cOGRecord.findMany({ where: { facilityId: fac.id, vendor: { name: { contains: "Arthrex", mode: "insensitive" } } }, select: { vendorItemNo: true }, distinct: ["vendorItemNo"], take: 50 })
  const skus = sample.map((s) => s.vendorItemNo)
  const jj = await prisma.vendor.findFirst({ where: { name: { contains: "Johnson", mode: "insensitive" } }, select: { id: true, name: true } })
  const scopedWrong = jj ? await prisma.cOGRecord.count({ where: { facilityId: fac.id, vendorId: jj.id, vendorItemNo: { in: skus, mode: "insensitive" } } }) : -1
  const unscoped = await prisma.cOGRecord.count({ where: { facilityId: fac.id, vendorItemNo: { in: skus, mode: "insensitive" } } })
  console.log(`50 Arthrex SKUs — scoped to ${jj?.name ?? "J&J?"}: ${scopedWrong} rows (old bug path → 0 matches); unscoped probe: ${unscoped} rows (mismatch warning fires + names the real vendor)`)
}

async function main() {
  await reviewVolume(); await reviewCarveOut(); await reviewVendorSide(); await reviewProposalJoin()
}
main().finally(() => prisma.$disconnect())
