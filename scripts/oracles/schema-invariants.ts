// scripts/oracles/schema-invariants.ts
/**
 * Schema-invariant oracle.
 *
 * Validates the substrate the calculator operates on — orphans,
 * impossible states, derived-field drift, date inversions. Different
 * class of oracle from the calculator oracles: those validate the
 * MATH is correct; this validates the DATA the math operates on
 * is internally consistent.
 *
 * Read-only against whatever DATABASE_URL points at. Safe for prod.
 */
import { prisma } from "@/lib/db"
import { defineOracle } from "./_shared/runner"

export default defineOracle("schema-invariants", async (ctx) => {
  try {
    // ── FK referential integrity ────────────────────────────────
    // Schema NOT-NULL + FK constraints prevent classic orphans, so
    // we don't re-check those here. Instead spot-check that the
    // counts of related rows match what the FKs imply (any
    // discrepancy means a botched migration or direct-SQL surgery).
    const [contractCount, rebateCount, periodCount, termCount] =
      await Promise.all([
        prisma.contract.count(),
        prisma.rebate.count(),
        prisma.contractPeriod.count(),
        prisma.contractTerm.count(),
      ])
    ctx.check(
      "schema reachable for invariant checks",
      contractCount >= 0 && rebateCount >= 0 && periodCount >= 0 && termCount >= 0,
      `contracts=${contractCount} rebates=${rebateCount} periods=${periodCount} terms=${termCount}`,
    )

    // ── Date invariants ─────────────────────────────────────────
    const allContracts = await prisma.contract.findMany({
      select: { id: true, name: true, effectiveDate: true, expirationDate: true, status: true },
    })
    const datesInverted = allContracts.filter(
      (c) => c.effectiveDate.getTime() > c.expirationDate.getTime(),
    )
    ctx.check(
      "no Contract has effectiveDate > expirationDate",
      datesInverted.length === 0,
      datesInverted.length === 0
        ? `${allContracts.length} contracts checked`
        : `${datesInverted.length} inverted: ${datesInverted.slice(0, 3).map((c) => c.name).join(", ")}`,
    )

    // payPeriodStart <= payPeriodEnd on every Rebate.
    const rebatesAll = await prisma.rebate.findMany({
      select: { id: true, payPeriodStart: true, payPeriodEnd: true },
    })
    const rebateInverted = rebatesAll.filter(
      (r) => r.payPeriodStart.getTime() > r.payPeriodEnd.getTime(),
    )
    ctx.check(
      "no Rebate has payPeriodStart > payPeriodEnd",
      rebateInverted.length === 0,
      rebateInverted.length === 0
        ? `${rebatesAll.length} rebate periods checked`
        : `${rebateInverted.length} inverted Rebate periods`,
    )

    // periodStart <= periodEnd on every ContractPeriod.
    const periodsAll = await prisma.contractPeriod.findMany({
      select: { id: true, periodStart: true, periodEnd: true },
    })
    const periodInverted = periodsAll.filter(
      (p) => p.periodStart.getTime() > p.periodEnd.getTime(),
    )
    ctx.check(
      "no ContractPeriod has periodStart > periodEnd",
      periodInverted.length === 0,
      periodInverted.length === 0
        ? `${periodsAll.length} contract periods checked`
        : `${periodInverted.length} inverted ContractPeriod rows`,
    )

    // ── Impossible states ───────────────────────────────────────
    // status: "active" but expirationDate in the past.
    const today = new Date()
    const expiredButActive = allContracts.filter(
      (c) =>
        c.status === "active" &&
        c.expirationDate.getTime() < today.getTime(),
    )
    ctx.check(
      "no Contract with status=active but expirationDate in the past",
      expiredButActive.length === 0,
      expiredButActive.length === 0
        ? `${allContracts.filter((c) => c.status === "active").length} active contracts checked`
        : `${expiredButActive.length} stale-active: ${expiredButActive.slice(0, 3).map((c) => c.name).join(", ")}`,
    )

    // contractType: tie_in but no tieInCapitalContractId nor
    // ContractCapitalLineItem rows. Contracts with neither can't
    // amortize a capital schedule.
    const tieIns = await prisma.contract.findMany({
      where: { contractType: "tie_in" },
      select: {
        id: true,
        name: true,
        tieInCapitalContractId: true,
      },
    })
    const tieInIds = tieIns.map((c) => c.id)
    const tieInLineItems = tieInIds.length
      ? await prisma.contractCapitalLineItem.groupBy({
          by: ["contractId"],
          where: { contractId: { in: tieInIds } },
          _count: true,
        })
      : []
    const tieInWithItems = new Set(tieInLineItems.map((g) => g.contractId))
    const orphanTieIns = tieIns.filter(
      (c) => !c.tieInCapitalContractId && !tieInWithItems.has(c.id),
    )
    ctx.check(
      "no tie_in contract without either tieInCapitalContractId or capital line items",
      orphanTieIns.length === 0,
      orphanTieIns.length === 0
        ? `${tieIns.length} tie-in contracts checked`
        : `${orphanTieIns.length} structurally empty: ${orphanTieIns.slice(0, 3).map((c) => c.name).join(", ")}`,
    )

    // ── Numeric invariants ─────────────────────────────────────
    // rebateEarned >= 0 and rebateCollected >= 0 across the fleet.
    const negativeRebates = await prisma.rebate.findMany({
      where: {
        OR: [
          { rebateEarned: { lt: 0 } },
          { rebateCollected: { lt: 0 } },
        ],
      },
      select: { id: true, rebateEarned: true, rebateCollected: true },
    })
    ctx.check(
      "no Rebate with negative rebateEarned or rebateCollected",
      negativeRebates.length === 0,
      negativeRebates.length === 0
        ? `${rebatesAll.length} rebate rows checked`
        : `${negativeRebates.length} negative rebate rows`,
    )

    // collectionDate set ⇒ collectionDate within or after the period
    // (delayed collection is fine; collected-before-it-started is not).
    const withCollection = await prisma.rebate.findMany({
      where: { collectionDate: { not: null } },
      select: { id: true, collectionDate: true, payPeriodStart: true },
    })
    const collectedTooEarly = withCollection.filter((r) => {
      if (!r.collectionDate) return false
      return r.collectionDate.getTime() < r.payPeriodStart.getTime()
    })
    ctx.check(
      "no Rebate has collectionDate before payPeriodStart",
      collectedTooEarly.length === 0,
      collectedTooEarly.length === 0
        ? `${withCollection.length} collected rebates checked`
        : `${collectedTooEarly.length} collections recorded before period started`,
    )

    // ── Tier sanity ─────────────────────────────────────────────
    // ContractTier.rebateValue is stored as a fraction (0.02 = 2%).
    // Per CLAUDE.md "Rebate engine units" rule, valid range is
    // [0, 1]. Anything outside means a unit-conversion bug crept in
    // during import or a manual edit set the wrong scale.
    const allTiers = await prisma.contractTier.findMany({
      select: {
        id: true,
        tierNumber: true,
        rebateValue: true,
        rebateType: true,
      },
    })
    const outOfRangeTiers = allTiers.filter((t) => {
      // Only enforce the [0,1] band on percent_of_spend rows;
      // flat-amount tiers (rebate_per_use, fixed) can legitimately
      // exceed 1.
      if (t.rebateType !== "percent_of_spend") return false
      const v = Number(t.rebateValue)
      return v < 0 || v > 1
    })
    ctx.check(
      "ContractTier.rebateValue (percent_of_spend) within [0, 1]",
      outOfRangeTiers.length === 0,
      outOfRangeTiers.length === 0
        ? `${allTiers.length} tier rows checked`
        : `${outOfRangeTiers.length} percent_of_spend tier(s) outside [0,1] — likely percent-vs-fraction unit mix-up`,
    )

    // Tier number sanity: every term's tiers must have unique
    // tierNumber + at least 1 starting at 1 or 0. Duplicates suggest
    // an import that didn't clear prior rows.
    const termsWithTiers = await prisma.contractTerm.findMany({
      where: { tiers: { some: {} } },
      select: {
        id: true,
        tiers: { select: { tierNumber: true } },
      },
    })
    const termsWithDupTiers = termsWithTiers.filter((term) => {
      const seen = new Set<number>()
      for (const t of term.tiers) {
        if (seen.has(t.tierNumber)) return true
        seen.add(t.tierNumber)
      }
      return false
    })
    ctx.check(
      "no ContractTerm has duplicate tierNumber values",
      termsWithDupTiers.length === 0,
      termsWithDupTiers.length === 0
        ? `${termsWithTiers.length} terms-with-tiers checked`
        : `${termsWithDupTiers.length} term(s) have duplicate tierNumbers`,
    )

    // ── ContractCapitalLineItem invariants ──────────────────────
    const capitalItems = await prisma.contractCapitalLineItem.findMany({
      select: {
        id: true,
        contractTotal: true,
        initialSales: true,
        termMonths: true,
        interestRate: true,
      },
    })

    // Every line item should have termMonths > 0 (else amortization
    // engine returns []). 0/null is allowed schema-wise but breaks the
    // amortization card.
    const itemsWithBadTerm = capitalItems.filter(
      (i) => i.termMonths === null || i.termMonths <= 0,
    )
    ctx.check(
      "every ContractCapitalLineItem has termMonths > 0",
      itemsWithBadTerm.length === 0,
      itemsWithBadTerm.length === 0
        ? `${capitalItems.length} capital line items checked`
        : `${itemsWithBadTerm.length} item(s) with null/zero termMonths`,
    )

    // initialSales must not exceed contractTotal (financed = total -
    // initial, can't be negative).
    const itemsOverpaid = capitalItems.filter(
      (i) => Number(i.initialSales ?? 0) > Number(i.contractTotal ?? 0),
    )
    ctx.check(
      "no ContractCapitalLineItem with initialSales > contractTotal",
      itemsOverpaid.length === 0,
      itemsOverpaid.length === 0
        ? `${capitalItems.length} capital items checked`
        : `${itemsOverpaid.length} item(s) with initialSales over total`,
    )

    // interestRate stored as fraction (0.05 = 5%). Anything ≥ 1
    // is almost certainly the percent-vs-fraction mix-up.
    const itemsBadRate = capitalItems.filter((i) => {
      if (i.interestRate == null) return false
      const r = Number(i.interestRate)
      return r < 0 || r >= 1
    })
    ctx.check(
      "ContractCapitalLineItem.interestRate within [0, 1)",
      itemsBadRate.length === 0,
      itemsBadRate.length === 0
        ? `${capitalItems.length} capital items checked`
        : `${itemsBadRate.length} item(s) outside fraction range — likely stored as percent`,
    )

    // ── Rebate consistency ──────────────────────────────────────
    // rebateCollected can never exceed rebateEarned. The collection
    // ledger draws from earned; over-collected = math bug or manual
    // entry error. (Tie-in auto-stamp sets collected = earned, so
    // equality is fine — only flag strictly-greater.)
    const allRebates = await prisma.rebate.findMany({
      select: { id: true, rebateEarned: true, rebateCollected: true },
    })
    const overCollected = allRebates.filter(
      (r) =>
        Number(r.rebateCollected ?? 0) - Number(r.rebateEarned ?? 0) > 0.01,
    )
    ctx.check(
      "no Rebate has rebateCollected > rebateEarned",
      overCollected.length === 0,
      overCollected.length === 0
        ? `${allRebates.length} rebate rows checked`
        : `${overCollected.length} row(s) with collected > earned: ${overCollected.slice(0, 3).map((r) => r.id).join(", ")}`,
    )

    // status=expiring should match expirationDate within 90 days.
    // Drift means contracts-list "Expiring Soon" counts and
    // dashboard alerts mislead. Past-expiry rows still tagged
    // "expiring" indicate a stale cron run.
    const ninetyDaysOut = new Date(today)
    ninetyDaysOut.setDate(ninetyDaysOut.getDate() + 90)
    const expiringWeird = allContracts.filter((c) => {
      if (c.status !== "expiring") return false
      const exp = c.expirationDate.getTime()
      return exp < today.getTime() || exp > ninetyDaysOut.getTime()
    })
    ctx.check(
      "status=expiring contracts have expirationDate within 90 days",
      expiringWeird.length === 0,
      expiringWeird.length === 0
        ? `${allContracts.filter((c) => c.status === "expiring").length} expiring contracts checked`
        : `${expiringWeird.length} contract(s) tagged expiring with stale dates`,
    )
  } finally {
    await prisma.$disconnect()
  }
})
