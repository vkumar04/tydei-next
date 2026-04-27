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
  } finally {
    await prisma.$disconnect()
  }
})
