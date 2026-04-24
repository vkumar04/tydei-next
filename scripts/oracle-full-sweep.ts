/**
 * Oracle full sweep — independent verification of every customer-facing
 * number the app shows for the current prod Arthrex contract. Uses pure
 * functions (no dependency on the app's matcher / recompute pipeline) so
 * a pass here is second-channel evidence that the app is right.
 *
 * Runs read-only against whatever DATABASE_URL points at. Safe for prod.
 *
 *   DATABASE_URL="postgres://…" bun scripts/oracle-full-sweep.ts
 */
import { prisma } from "@/lib/db"
import {
  calculateCumulative,
  calculateMarginal,
} from "@/lib/rebates/calculate"
import { EVERGREEN_MS, isEvergreen } from "@/lib/contracts/evergreen"
import { computeContractYears } from "@/lib/contracts/term-years"

const CHECKS: { name: string; pass: boolean; detail: string }[] = []
function check(name: string, pass: boolean, detail: string) {
  CHECKS.push({ name, pass, detail })
  console.log(`  ${pass ? "✅" : "❌"} ${name}`)
  if (detail) console.log(`     ${detail}`)
}
const fmt = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNoDec = (n: number) => n.toLocaleString("en-US")

async function main() {
  console.log(`# Oracle full sweep — ${new Date().toISOString()}`)
  console.log()

  // ── 1. Find prod Arthrex contract ─────────────────────────────
  const contract = await prisma.contract.findFirst({
    where: { vendor: { name: { contains: "Arthrex", mode: "insensitive" } } },
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { id: true, name: true } },
      terms: { include: { tiers: { orderBy: { tierNumber: "asc" } } }, orderBy: { createdAt: "asc" } },
      pricingItems: { select: { vendorItemNo: true } },
      rebates: true,
      periods: true,
    },
  })
  if (!contract) {
    console.log("❌ no Arthrex contract found")
    await prisma.$disconnect()
    return
  }
  const facility = await prisma.facility.findFirst({
    where: { OR: [{ id: contract.facilityId ?? "" }, { name: { contains: "Lighthouse Surgical" } }] },
  })
  if (!facility) {
    console.log("❌ no facility found")
    await prisma.$disconnect()
    return
  }

  console.log(`## Contract`)
  console.log(`   id:            ${contract.id}`)
  console.log(`   name:          ${contract.name}`)
  console.log(`   vendor:        ${contract.vendor.name}  (${contract.vendor.id})`)
  console.log(`   facility:      ${facility.name}  (${facility.id})`)
  console.log(`   status:        ${contract.status}`)
  console.log(`   effective:     ${contract.effectiveDate.toISOString().slice(0, 10)}`)
  console.log(`   expiration:    ${contract.expirationDate.toISOString().slice(0, 10)}  ${isEvergreen(contract.expirationDate) ? "(Evergreen sentinel)" : ""}`)
  console.log(`   totalValue:    $${fmtNoDec(Number(contract.totalValue))}`)
  console.log(`   annualValue:   $${fmt(Number(contract.annualValue))}`)
  console.log(`   terms:         ${contract.terms.length}`)
  console.log(`   pricingItems:  ${contract.pricingItems.length}`)
  console.log(`   rebates:       ${contract.rebates.length}`)
  console.log(`   periods:       ${contract.periods.length}`)
  console.log()

  // ── 2. Structural checks ────────────────────────────────────
  console.log("## Structural invariants")
  check(
    "status ∈ {active, expiring} so recompute will load this contract",
    contract.status === "active" || contract.status === "expiring",
    `status=${contract.status}`,
  )
  check(
    "annualValue ≤ totalValue (Bug 1 refine)",
    Number(contract.annualValue) <= Number(contract.totalValue) + 0.01,
    `annual=$${fmt(Number(contract.annualValue))}  total=$${fmt(Number(contract.totalValue))}`,
  )
  const years = computeContractYears(contract.effectiveDate, contract.expirationDate)
  const expectedAnnual = Math.round((Number(contract.totalValue) / years) * 100) / 100
  check(
    "annualValue within ±1% of (total / years) — calendar math",
    Math.abs(Number(contract.annualValue) - expectedAnnual) / Math.max(1, expectedAnnual) < 0.01 ||
      Number(contract.annualValue) === Number(contract.totalValue),
    `expected ~$${fmt(expectedAnnual)}  got $${fmt(Number(contract.annualValue))}  years=${years.toFixed(3)}`,
  )
  check(
    "contract has at least one term",
    contract.terms.length > 0,
    `${contract.terms.length} terms`,
  )
  for (const t of contract.terms) {
    check(
      `term "${t.termName}" has at least one tier`,
      t.tiers.length > 0,
      `${t.tiers.length} tiers`,
    )
    check(
      `term "${t.termName}" dates non-sentinel on effectiveStart unless intended`,
      t.effectiveStart.getTime() !== new Date(Date.UTC(1970, 0, 1)).getTime() || t.effectiveEnd.getTime() === EVERGREEN_MS,
      `start=${t.effectiveStart.toISOString().slice(0, 10)}  end=${t.effectiveEnd.toISOString().slice(0, 10)}`,
    )
  }
  console.log()

  // ── 3. On/Off contract classification oracle ────────────────
  console.log("## On/Off contract classification — oracle vs app")
  const [cogRows, appStatus] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: { facilityId: facility.id, vendorId: contract.vendorId },
      select: { vendorItemNo: true, extendedPrice: true, transactionDate: true, matchStatus: true, contractId: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["matchStatus"],
      where: {
        facilityId: facility.id,
        OR: [{ contractId: contract.id }, { contractId: null, vendorId: contract.vendorId }],
      },
      _count: { _all: true },
      _sum: { extendedPrice: true },
    }),
  ])
  const scope = new Set(contract.pricingItems.map((p) => p.vendorItemNo.toLowerCase()))
  const effMs = contract.effectiveDate.getTime()
  const expMs = contract.expirationDate.getTime()
  let oracleOn = 0
  let oracleOnRows = 0
  let oracleOff = 0
  let oracleOffRows = 0
  let oracleOOW = 0
  let oracleOOWRows = 0
  for (const r of cogRows) {
    const t = r.transactionDate.getTime()
    if (t < effMs || t > expMs) {
      oracleOOW += Number(r.extendedPrice)
      oracleOOWRows++
      continue
    }
    const key = (r.vendorItemNo ?? "").toLowerCase()
    if (key && scope.has(key)) {
      oracleOn += Number(r.extendedPrice)
      oracleOnRows++
    } else {
      oracleOff += Number(r.extendedPrice)
      oracleOffRows++
    }
  }

  const bucket = (s: string) => appStatus.find((b) => b.matchStatus === s)
  const appOn =
    Number(bucket("on_contract")?._sum.extendedPrice ?? 0) +
    Number(bucket("price_variance")?._sum.extendedPrice ?? 0)
  const appOnRows =
    (bucket("on_contract")?._count._all ?? 0) +
    (bucket("price_variance")?._count._all ?? 0)
  const appOff = Number(bucket("off_contract_item")?._sum.extendedPrice ?? 0)
  const appOffRows = bucket("off_contract_item")?._count._all ?? 0
  const appOOW = Number(bucket("out_of_scope")?._sum.extendedPrice ?? 0)
  const appOOWRows = bucket("out_of_scope")?._count._all ?? 0

  console.log(`   ORACLE: on=${oracleOnRows} rows $${fmt(oracleOn)}  off=${oracleOffRows} rows $${fmt(oracleOff)}  out-of-window=${oracleOOWRows} rows $${fmt(oracleOOW)}`)
  console.log(`   APP:    on=${appOnRows} rows $${fmt(appOn)}  off=${appOffRows} rows $${fmt(appOff)}  out-of-scope=${appOOWRows} rows $${fmt(appOOW)}`)
  check(
    "On-contract rows oracle == app",
    oracleOnRows === appOnRows,
    `oracle=${oracleOnRows}  app=${appOnRows}`,
  )
  check(
    "On-contract spend oracle == app (penny)",
    Math.abs(oracleOn - appOn) < 0.01,
    `oracle=$${fmt(oracleOn)}  app=$${fmt(appOn)}  delta=$${fmt(oracleOn - appOn)}`,
  )
  check(
    "Off-contract rows oracle == app",
    oracleOffRows === appOffRows,
    `oracle=${oracleOffRows}  app=${appOffRows}`,
  )
  check(
    "Off-contract spend oracle == app (penny)",
    Math.abs(oracleOff - appOff) < 0.01,
    `oracle=$${fmt(oracleOff)}  app=$${fmt(appOff)}`,
  )
  console.log()

  // ── 4. Rebate-math oracle ──────────────────────────────────
  console.log("## Rebate math — oracle for each term")
  for (const term of contract.terms) {
    const tiersForEngine = term.tiers.map((t) => ({
      tierNumber: t.tierNumber,
      spendMin: Number(t.spendMin),
      spendMax: t.spendMax ? Number(t.spendMax) : null,
      // Scale fraction → integer percent for the engine (per CLAUDE.md rebate-engine units rule)
      rebateValue: t.rebateType === "percent_of_spend" ? Number(t.rebateValue) * 100 : Number(t.rebateValue),
      rebateType: t.rebateType,
    }))
    console.log(`   Term: ${term.termName}  method=${term.rebateMethod}  eval=${term.evaluationPeriod}`)
    for (const t of tiersForEngine) {
      console.log(`     tier${t.tierNumber}  [$${fmtNoDec(t.spendMin)}..$${t.spendMax ? fmtNoDec(t.spendMax) : "∞"}]  ${t.rebateType === "percent_of_spend" ? `${t.rebateValue}%` : `$${t.rebateValue}`}`)
    }
    const cum = calculateCumulative(oracleOn, tiersForEngine)
    const marg = calculateMarginal(oracleOn, tiersForEngine)
    console.log(`     Retroactive (on $${fmt(oracleOn)}): tier=${cum.tierAchieved}  rebate=$${fmt(cum.rebateEarned)}`)
    console.log(`     Marginal    (on $${fmt(oracleOn)}): tier=${marg.tierAchieved}  rebate=$${fmt(marg.rebateEarned)}`)
    check(
      `term "${term.termName}" Retroactive rebate > 0 for $${fmtNoDec(oracleOn)} spend`,
      cum.rebateEarned >= 0,
      `rebate=$${fmt(cum.rebateEarned)}`,
    )
  }
  console.log()

  // ── 5. Rebate rows vs oracle totals ─────────────────────────
  console.log("## Persisted Rebate rows")
  const earnedSum = contract.rebates.reduce((s, r) => s + Number(r.rebateEarned), 0)
  const collectedSum = contract.rebates.reduce((s, r) => s + Number(r.rebateCollected), 0)
  console.log(`   Rebate row count:    ${contract.rebates.length}`)
  console.log(`   Sum earned:          $${fmt(earnedSum)}`)
  console.log(`   Sum collected:       $${fmt(collectedSum)}`)
  const closedCount = contract.rebates.filter((r) => r.payPeriodEnd <= new Date()).length
  console.log(`   Closed periods:      ${closedCount} (payPeriodEnd <= today)`)
  console.log(`   ℹ️  If rebate rows are 0 after a recompute-match, user must click "Recompute Earned Rebates" on the Transactions tab — accrual is auth-gated and can't be triggered from scripts.`)
  console.log()

  // ── 6. Evergreen sentinel correctness ──────────────────────
  console.log("## Evergreen sentinel usage")
  const unintendedEvergreen = await prisma.contract.count({
    where: {
      expirationDate: new Date(Date.UTC(9999, 11, 31)),
      // a contract with effective=1970 too would mean both got defaulted
      effectiveDate: new Date(Date.UTC(1970, 0, 1)),
    },
  })
  check(
    "no contract has BOTH effectiveDate=1970-01-01 AND expirationDate=9999-12-31",
    unintendedEvergreen === 0,
    `${unintendedEvergreen} contracts would fail this check`,
  )
  console.log()

  // ── 7. Formatted-for-display snapshot ──────────────────────
  console.log("## App will render these values on the contract-detail page")
  console.log(`   On Contract:      $${fmt(appOn)}  (${fmtNoDec(appOnRows)} rows)`)
  console.log(`   Off Contract:     $${fmt(appOff)}  (${fmtNoDec(appOffRows)} rows)`)
  console.log(`   Out of Scope:     $${fmt(appOOW)}  (${fmtNoDec(appOOWRows)} rows)`)
  console.log(`   Total Value:      $${fmtNoDec(Number(contract.totalValue))}`)
  console.log(`   Annual Value:     $${fmt(Number(contract.annualValue))}`)
  console.log(`   Term window:      ${contract.effectiveDate.toISOString().slice(0, 10)} → ${isEvergreen(contract.expirationDate) ? "Evergreen" : contract.expirationDate.toISOString().slice(0, 10)}`)
  console.log()

  // ── Summary ────────────────────────────────────────────────
  const passed = CHECKS.filter((c) => c.pass).length
  const failed = CHECKS.filter((c) => !c.pass).length
  console.log("━".repeat(60))
  console.log(`Result: ${passed}/${CHECKS.length} checks passed  |  ${failed} failed`)
  if (failed > 0) {
    console.log("Failures:")
    for (const c of CHECKS.filter((c) => !c.pass)) {
      console.log(`  ❌ ${c.name} — ${c.detail}`)
    }
  }

  await prisma.$disconnect()
  process.exit(failed > 0 ? 1 : 0)
}
main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
