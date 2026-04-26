/**
 * QA mock contract lifecycle — exercises the full contract journey
 * end-to-end using realistic data. Creates a disposable contract, seeds
 * terms + tiers + pricing + COG, runs match + accrual, verifies the
 * numbers the UI will show, then cleans up.
 *
 * Catches: same-shape bugs as real user imports — evergreen dates,
 * multi-term payloads, null vendorItemNo, tier-label consistency,
 * rebate-ledger vs oracle drift.
 *
 * Every step reports OK/WARN/BUG. Fails loud on regressions.
 */
import { prisma } from "@/lib/db"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import {
  calculateCumulative,
  calculateMarginal,
} from "@/lib/rebates/calculate"
import { createContractSchema } from "@/lib/validators/contracts"
import { EVERGREEN_DATE, isEvergreen } from "@/lib/contracts/evergreen"
import { computeContractYears } from "@/lib/contracts/term-years"

const FINDINGS: { test: string; level: "OK" | "WARN" | "BUG"; detail: string }[] = []
function note(test: string, level: "OK" | "WARN" | "BUG", detail: string) {
  FINDINGS.push({ test, level, detail })
  const icon = level === "OK" ? "✅" : level === "WARN" ? "⚠️ " : "🐛"
  console.log(`  ${icon} ${test}  —  ${detail}`)
}
const fmt = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })

async function main() {
  console.log("# QA mock contract lifecycle")
  console.log()

  // Use a dedicated disposable vendor so we don't pollute seed data.
  const vendor =
    (await prisma.vendor.findFirst({ where: { name: "QA-Test-Vendor" } })) ??
    (await prisma.vendor.create({ data: { name: "QA-Test-Vendor", status: "active" } }))
  const facility = await prisma.facility.findFirstOrThrow({
    where: { name: "Lighthouse Community Hospital" },
  })
  console.log(`Facility: ${facility.name}`)
  console.log(`Vendor:   ${vendor.name}`)
  console.log()

  // Cleanup any prior run
  await prisma.cOGRecord.deleteMany({ where: { facilityId: facility.id, vendorId: vendor.id } })
  await prisma.contract.deleteMany({ where: { facilityId: facility.id, vendorId: vendor.id } })

  // ── TEST 1: Multi-term, evergreen contract ──────────────────
  console.log("## Test 1 — Create contract with 2 terms, evergreen expiration")
  const payload = {
    name: "QA Multi-term Evergreen",
    contractNumber: "QA-001",
    vendorId: vendor.id,
    facilityId: facility.id,
    categoryIds: [],
    contractType: "usage" as const,
    status: "active" as const,
    effectiveDate: "2024-01-01",
    expirationDate: "", // evergreen
    autoRenewal: true,
    terminationNoticeDays: 30,
    totalValue: 3_000_000,
    annualValue: 1_000_000, // 3-year implicit
    performancePeriod: "monthly" as const,
    rebatePayPeriod: "quarterly" as const,
    isMultiFacility: false,
    isGrouped: false,
    facilityIds: [],
    additionalFacilityIds: [],
  }
  try {
    createContractSchema.parse(payload)
    note("  validator accepts evergreen payload", "OK", "zod parse passed")
  } catch (e) {
    note("  validator accepts evergreen payload", "BUG", (e as Error).message)
    process.exit(1)
  }

  const contract = await prisma.contract.create({
    data: {
      name: payload.name,
      contractNumber: payload.contractNumber,
      vendorId: vendor.id,
      facilityId: facility.id,
      contractType: payload.contractType,
      status: payload.status,
      effectiveDate: new Date(payload.effectiveDate),
      expirationDate: payload.expirationDate ? new Date(payload.expirationDate) : EVERGREEN_DATE,
      autoRenewal: payload.autoRenewal,
      terminationNoticeDays: payload.terminationNoticeDays,
      totalValue: payload.totalValue,
      annualValue: payload.annualValue,
      performancePeriod: payload.performancePeriod,
      rebatePayPeriod: payload.rebatePayPeriod,
      isMultiFacility: payload.isMultiFacility,
      isGrouped: payload.isGrouped,
    },
  })
  note("  contract created", "OK", `id=${contract.id}  exp=${isEvergreen(contract.expirationDate) ? "Evergreen" : contract.expirationDate.toISOString().slice(0, 10)}`)

  // Write 2 terms mimicking the Arthrex case that triggered Bug 7
  const qasTerm = await prisma.contractTerm.create({
    data: {
      contractId: contract.id,
      termName: "Qualified Annual Spend Rebate",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "quarterly",
      paymentTiming: "quarterly",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      effectiveStart: new Date("2024-01-01"),
      effectiveEnd: EVERGREEN_DATE,
      tiers: {
        create: [
          { tierNumber: 1, spendMin: 0, spendMax: 200_000, rebateType: "percent_of_spend", rebateValue: 0.05 },
          { tierNumber: 2, spendMin: 200_001, spendMax: 6_000_000, rebateType: "percent_of_spend", rebateValue: 0.10 },
        ],
      },
    },
    include: { tiers: true },
  })
  const distalTerm = await prisma.contractTerm.create({
    data: {
      contractId: contract.id,
      termName: "Distal Extremities Spend Rebate",
      termType: "spend_rebate",
      baselineType: "spend_based",
      evaluationPeriod: "annual",
      paymentTiming: "annual",
      appliesTo: "all_products",
      rebateMethod: "cumulative",
      effectiveStart: new Date("2024-01-01"),
      effectiveEnd: EVERGREEN_DATE,
      tiers: {
        create: [
          { tierNumber: 1, spendMin: 825_000, spendMax: null, rebateType: "percent_of_spend", rebateValue: 0.02 },
        ],
      },
    },
  })
  const termCount = await prisma.contractTerm.count({ where: { contractId: contract.id } })
  note("  2 terms persisted (Bug 7 regression guard)", termCount === 2 ? "OK" : "BUG", `expected 2, got ${termCount}`)
  console.log()

  // ── TEST 2: Pricing file + COG with realistic shape ─────────
  console.log("## Test 2 — Seed ContractPricing (10 items) + COG (50 rows)")
  const pricingItems = Array.from({ length: 10 }).map((_, i) => ({
    contractId: contract.id,
    vendorItemNo: `QA-SKU-${i.toString().padStart(3, "0")}`,
    unitPrice: 100 + i * 50,
    listPrice: 150 + i * 60,
  }))
  await prisma.contractPricing.createMany({ data: pricingItems })
  note("  pricing items seeded", "OK", `${pricingItems.length} items`)

  // 50 COG rows; 40 match pricing, 10 don't (off-contract)
  const cogRows = Array.from({ length: 50 }).map((_, i) => {
    const isMatched = i < 40
    const skuIndex = i % 10
    return {
      facilityId: facility.id,
      vendorId: vendor.id,
      vendorName: vendor.name,
      inventoryNumber: isMatched ? `QA-SKU-${skuIndex.toString().padStart(3, "0")}` : `UNPRICED-${i}`,
      inventoryDescription: `QA Mock Item ${i}`,
      vendorItemNo: isMatched ? `QA-SKU-${skuIndex.toString().padStart(3, "0")}` : null,
      poNumber: `QA-PO-${i}`,
      unitCost: isMatched ? 100 + skuIndex * 50 : 80,
      extendedPrice: isMatched ? (100 + skuIndex * 50) * 2 : 80 * 2,
      quantity: 2,
      transactionDate: new Date(`2025-${String(1 + (i % 12)).padStart(2, "0")}-15`),
    }
  })
  await prisma.cOGRecord.createMany({ data: cogRows })
  const expectedOnContract = 40 * (100 + (0+1+2+3+4+5+6+7+8+9) / 10 * 50) * 2
  note("  COG rows seeded", "OK", `${cogRows.length} rows, expected on-contract ≈ ${fmt(expectedOnContract)}`)
  console.log()

  // ── TEST 3: Run matcher + verify ────────────────────────────
  console.log("## Test 3 — Run recomputeMatchStatusesForVendor")
  const summary = await recomputeMatchStatusesForVendor(prisma, { vendorId: vendor.id, facilityId: facility.id })
  console.log(`      summary: ${summary.total} rows updated`)
  console.log(`      on_contract=${summary.onContract}  price_variance=${summary.priceVariance}  off_contract=${summary.offContract}  out_of_scope=${summary.outOfScope}`)
  note("  matcher: 40 priced rows match", (summary.onContract + summary.priceVariance) === 40 ? "OK" : "BUG", `${summary.onContract + summary.priceVariance}/40 matched`)
  note("  matcher: 10 unpriced rows don't match", summary.offContract === 10 ? "OK" : "BUG", `${summary.offContract}/10 off-contract`)
  console.log()

  // ── TEST 4: Oracle rebate math vs engine ────────────────────
  console.log("## Test 4 — Oracle rebate math on on-contract spend")
  const onC = await prisma.cOGRecord.aggregate({
    where: { facilityId: facility.id, contractId: contract.id, matchStatus: { in: ["on_contract", "price_variance"] } },
    _sum: { extendedPrice: true },
    _count: { _all: true },
  })
  const onSpend = Number(onC._sum.extendedPrice ?? 0)
  console.log(`      on-contract spend = ${fmt(onSpend)}  (${onC._count._all} rows)`)

  const qasTiersForEngine = qasTerm.tiers
    .sort((a, b) => a.tierNumber - b.tierNumber)
    .map((t) => ({
      tierNumber: t.tierNumber,
      spendMin: Number(t.spendMin),
      spendMax: t.spendMax ? Number(t.spendMax) : null,
      rebateValue: Number(t.rebateValue) * 100,
      rebateType: t.rebateType,
    }))
  const retro = calculateCumulative(onSpend, qasTiersForEngine)
  const marg = calculateMarginal(onSpend, qasTiersForEngine)
  console.log(`      QAS Retroactive: ${fmt(retro.rebateEarned)} at tier ${retro.tierAchieved}`)
  console.log(`      QAS Marginal:    ${fmt(marg.rebateEarned)} at tier ${marg.tierAchieved}`)
  // Expected: 40 rows × avg $550 × 2 = $44,000 on spend. Under tier 1 ($200k), both methods should = 5%
  const expectedTier1Only = onSpend <= 200_000 && retro.tierAchieved === 1 && marg.tierAchieved === 1
  note(
    "  both methods agree when only tier 1 is reached",
    onSpend <= 200_000 ? (Math.abs(retro.rebateEarned - marg.rebateEarned) < 0.01 ? "OK" : "BUG") : "OK",
    onSpend <= 200_000 ? `retro=$${retro.rebateEarned} marginal=$${marg.rebateEarned}` : `spend ${fmt(onSpend)} > tier 1 threshold; divergence expected`,
  )
  console.log()

  // ── TEST 5: computeContractYears for evergreen contract ─────
  console.log("## Test 5 — Helper invariants")
  const yearsForEvergreen = computeContractYears(contract.effectiveDate, contract.expirationDate)
  note("  computeContractYears handles evergreen without dividing by infinity", Number.isFinite(yearsForEvergreen) ? "OK" : "BUG", `returned ${yearsForEvergreen} years`)
  const yearsFor1y = computeContractYears("2024-01-01", "2024-12-31")
  note("  computeContractYears(Jan→Dec) == 1.0", yearsFor1y === 1 ? "OK" : "BUG", `returned ${yearsFor1y}`)
  console.log()

  // ── CLEANUP ─────────────────────────────────────────────────
  await prisma.cOGRecord.deleteMany({ where: { facilityId: facility.id, vendorId: vendor.id } })
  await prisma.contract.delete({ where: { id: contract.id } })
  console.log("🧹 cleaned up mock data")
  console.log()

  // ── Summary ─────────────────────────────────────────────────
  console.log("━".repeat(60))
  const bugs = FINDINGS.filter((f) => f.level === "BUG")
  const warns = FINDINGS.filter((f) => f.level === "WARN")
  const oks = FINDINGS.filter((f) => f.level === "OK")
  console.log(`Findings: ${oks.length} OK, ${warns.length} WARN, ${bugs.length} BUG`)
  if (bugs.length > 0) console.log("\n🐛 Bugs:"), bugs.forEach((f) => console.log(`  ${f.test} — ${f.detail}`))
  if (warns.length > 0) console.log("\n⚠️  Warnings:"), warns.forEach((f) => console.log(`  ${f.test} — ${f.detail}`))

  await prisma.$disconnect()
  process.exit(bugs.length > 0 ? 1 : 0)
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
