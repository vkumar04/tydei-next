"use server"

import { prisma } from "@/lib/db"
import type { Prisma } from "@/lib/generated/prisma/client"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeSyntheticContractPeriods } from "@/lib/actions/contract-periods"
import { getContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"
import { buildReportDataRows } from "@/lib/reports/report-data-core"

// ─── Contracts List (for report selector) ───────────────────────

export async function getContracts(_facilityId?: string) {
  const { facility } = await requireFacility()

  const contracts = await prisma.contract.findMany({
    where: {
      facilityId: facility.id,
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
    },
    orderBy: { name: "asc" },
  })

  return serialize(
    contracts.map((c) => ({
      id: c.id,
      name: c.name,
      contractType: c.contractType,
      status: c.status,
      vendorId: c.vendor.id,
      vendorName: c.vendor.name,
    }))
  )
}

// ─── Report Data ─────────────────────────────────────────────────

export async function getReportData(input: {
  facilityId?: string
  reportType: "usage" | "service" | "tie_in" | "capital" | "grouped"
  dateFrom: string
  dateTo: string
}) {
  const { facility } = await requireFacility()
  const facilityId = facility.id
  const { reportType, dateFrom, dateTo } = input

  const contracts = await prisma.contract.findMany({
    where: {
      facilityId,
      contractType: reportType === "grouped" ? "grouped" : reportType,
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      // Mirror PERIODS_CONTRACT_SELECT.terms so the synthetic-period
      // fallback (computeSyntheticContractPeriods) can scope the COG query
      // to the categories the contract's terms cover and qualify the
      // per-month tier. The contract's scalar fields the fallback needs
      // (effectiveDate, expirationDate, vendorId, additionalVendorIds,
      // facilityId) come back by default under `include`.
      terms: {
        select: {
          evaluationPeriod: true,
          appliesTo: true,
          categories: true,
          tiers: { orderBy: { tierNumber: "asc" as const } },
        },
        orderBy: { createdAt: "asc" as const },
      },
      periods: {
        where: {
          periodStart: { gte: new Date(dateFrom) },
          periodEnd: { lte: new Date(dateTo) },
        },
        orderBy: { periodStart: "asc" },
      },
      // Charles 2026-04-23 audit — canonical rebate totals on Reports
      // surfaces must come from the Rebate table via
      // sumEarnedRebatesLifetime / sumCollectedRebates, not from raw
      // `ContractPeriod.rebateEarned/Collected`. ContractPeriod is a
      // monthly rollup that can drift from the Rebate ledger (manual
      // rebate entries, out-of-band collections, auto-accrual tie-in
      // stamps). Fetching the rebate rows here and returning them
      // alongside the periods lets the tabs display ContractPeriod
      // rollups for the per-month ledger AND render canonical totals
      // computed from the Rebate table, guaranteeing Reports agrees
      // with Contract Detail / Dashboard / Contracts List.
      //
      // NOT windowed: the canonical earned/collected (and the footer
      // "Total (to date)" + Contract Margin) are LIFETIME figures — the
      // same sumEarnedRebatesLifetime / sumCollectedRebates the contracts
      // list uses. Windowing the fetch hid annual-cadence rebates whose
      // payPeriodEnd falls outside the report window (e.g. a 2024/2025
      // rebate viewed in a trailing-90-day window read as $0 collected even
      // though it was earned, collected, and applied to capital). Vick
      // 2026-06-22 "rebate collected not there". The per-month detail still
      // comes from the windowed `periods` above; only the canonical totals
      // are lifetime.
      rebates: {
        select: {
          payPeriodEnd: true,
          rebateEarned: true,
          collectionDate: true,
          rebateCollected: true,
        },
      },
    },
    orderBy: { name: "asc" },
  })

  const windowEnd = new Date(dateTo)
  const windowStart = new Date(dateFrom)

  // 2026-06-18 perf audit: fetch the facility COG-category universe ONCE (it's
  // facility-scoped, identical across all contracts) and thread it into the
  // per-contract synthetic-period fallback below — instead of that fallback
  // re-running a full-COG groupBy per contract (the N+1 worst case on
  // freshly-imported facilities with no persisted ContractPeriod rollups).
  const { facilityCogCategoryUniverse } = await import(
    "@/lib/contracts/cog-category-universe"
  )
  const reportsCogUniverse = await facilityCogCategoryUniverse(facilityId)

  // Per-contract row assembly lives in the shared pure core
  // `buildReportDataRows` (lib/reports/report-data-core.ts), which the
  // vendor mirror also uses so the two surfaces can never drift. The
  // facility wrapper injects its own facility-scoped synthetic-period
  // fallback and the facility-gated capital schedule.
  const contractRows = await buildReportDataRows({
    contracts,
    windowStart,
    windowEnd,
    // Facility COG is facility-scoped; the synthetic fallback always runs
    // for the active facility (matching the original always-call behavior).
    computeSynthetic: (c) =>
      computeSyntheticContractPeriods(c, facilityId, reportsCogUniverse),
    // Route through the canonical facility-gated getContractCapitalSchedule —
    // capitalCost (line items or totalValue), paidToDate (rebate applied +
    // logged payments/credits), and the remaining balance.
    resolveCapital: async (c) => {
      const sched = await getContractCapitalSchedule(c.id)
      return {
        capitalCost: sched.capitalCost,
        paidToDate: sched.paidToDate,
        remainingBalance: sched.remainingBalance,
      }
    },
  })

  return serialize({
    // Active facility name — surfaced once at the top level (not
    // per-contract) for the Contract Performance Details header band.
    facilityName: facility.name,
    contracts: contractRows,
    reportType,
    dateFrom,
    dateTo,
  })
}

// ─── Contract Period Data ────────────────────────────────────────

export async function getContractPeriodData(input: {
  contractId: string
  dateFrom?: string
  dateTo?: string
}) {
  const { facility } = await requireFacility()
  const { contractId, dateFrom, dateTo } = input

  // Ownership check. Without this, `requireFacility()` only proved the caller
  // is SOME facility user — the contractId came straight off the wire, so any
  // authenticated facility user could read any other tenant's ContractPeriod
  // rows: totalSpend, rebateEarned, rebateCollected, paymentActual, tier.
  // Confirmed exploitable against seeded data before the fix (security audit
  // 2026-07-26). Returns empty rather than throwing, so a stale link degrades
  // to "no data" instead of confirming that someone else's contract exists.
  const owned = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  if (!owned) return serialize([])

  const where: Record<string, unknown> = { contractId }
  if (dateFrom) where.periodStart = { gte: new Date(dateFrom) }
  if (dateTo) where.periodEnd = { lte: new Date(dateTo) }

  const periods = await prisma.contractPeriod.findMany({
    where,
    orderBy: { periodStart: "asc" },
  })

  return serialize(periods.map((p) => ({
    id: p.id,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    totalSpend: Number(p.totalSpend),
    totalVolume: p.totalVolume,
    rebateEarned: Number(p.rebateEarned),
    rebateCollected: Number(p.rebateCollected),
    paymentExpected: Number(p.paymentExpected),
    paymentActual: Number(p.paymentActual),
    tierAchieved: p.tierAchieved,
  })))
}

// ─── Export CSV ──────────────────────────────────────────────────

export async function exportReportCSV(input: {
  facilityId?: string
  reportType: string
  dateFrom: string
  dateTo: string
}) {
  // getReportData already calls requireFacility() and scopes to session facility
  const report = await getReportData({
    reportType: input.reportType as "usage" | "service" | "tie_in" | "capital" | "grouped",
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
  })

  const headers = [
    "Contract", "Vendor", "Period Start", "Period End",
    "Spend", "Volume", "Rebate Earned", "Rebate Collected",
    "Payment Expected", "Payment Actual", "Tier",
  ]

  const rows = report.contracts.flatMap((c) =>
    c.periods.map((p) =>
      [
        c.name, c.vendor, p.periodStart.split("T")[0], p.periodEnd.split("T")[0],
        p.totalSpend, p.totalVolume, p.rebateEarned, p.rebateCollected,
        p.paymentExpected, p.paymentActual, p.tierAchieved ?? "",
      ].join(",")
    )
  )

  return [headers.join(","), ...rows].join("\n")
}

// ─── Price Discrepancies ─────────────────────────────────────────

/**
 * Row cap on the price-discrepancy SAMPLE. Not exported — a `"use server"`
 * file may only export async functions — so `getPriceDiscrepancySummary`
 * hands it to the client as `rowCap` and the table labels the truncation
 * ("Showing 1,500 of 4,182").
 */
const PRICE_DISCREPANCY_ROW_CAP = 1500

/** The qualifying set, in ONE place, so the sample and the totals agree. */
const priceDiscrepancyWhere = (facilityId: string) =>
  ({
    facilityId,
    matchStatus: { in: ["price_variance", "off_contract_item"] },
  }) satisfies Prisma.COGRecordWhereInput

/**
 * Facility-wide price-discrepancy totals — the companion aggregate for
 * `getPriceDiscrepancies`, over the SAME `priceDiscrepancyWhere` set.
 *
 * `getPriceDiscrepancies` returns at most `PRICE_DISCREPANCY_ROW_CAP`
 * rows. The Price Discrepancy report's four summary cards used to reduce
 * over that capped array, so "Total Discrepancies", "Total Overcharges $",
 * "Total Undercharges $" and "Est. Savings $" all silently stopped at the
 * 1,500th highest-variance row (the local seed already puts Lighthouse
 * Surgical Center at 1,135 qualifying rows). Every card now reads from
 * here — full facility scope — and the row list is labelled as a sample.
 *
 * Dollars come from the persisted `savingsAmount` column, which
 * lib/cog/enrichment.ts owns: `(contractPrice - unitCost) × quantity`,
 * i.e. POSITIVE when the facility paid less than contract. The two
 * buckets are split by sign at the DB and NEVER netted — a $5k overcharge
 * and a $5k undercharge are two separate facts, not $0.
 *
 * Verified against the seeded Lighthouse Surgical Center (2026-07-28):
 * this aggregate and the reducer it replaces agree exactly when the
 * reducer is run over the full set — 973 overcharge rows / $472,173 —
 * so only the SCOPE changed, not the arithmetic. Deliberate difference:
 * enrichment nulls `savingsAmount` when its kit-vs-component sanity
 * check fires, and those rows now contribute no dollars instead of the
 * client re-deriving the fabricated figure enrichment suppressed.
 *
 * Three round trips (in parallel), not N: one count for the total, one
 * sign-filtered aggregate per bucket. A single `groupBy` can't do it —
 * there is no stored sign column to group on, and grouping by
 * `matchStatus` would net the two directions together.
 */
export async function getPriceDiscrepancySummary(_facilityId?: string) {
  const { facility } = await requireFacility()
  const where = priceDiscrepancyWhere(facility.id)

  const [totalDiscrepancies, overcharge, undercharge] = await Promise.all([
    prisma.cOGRecord.count({ where }),
    prisma.cOGRecord.aggregate({
      where: { ...where, savingsAmount: { lt: 0 } },
      _sum: { savingsAmount: true },
      _count: { _all: true },
    }),
    prisma.cOGRecord.aggregate({
      where: { ...where, savingsAmount: { gt: 0 } },
      _sum: { savingsAmount: true },
      _count: { _all: true },
    }),
  ])

  // `_sum` is null when no row matches — coalesce before negating, and
  // normalize the resulting -0 (negating 0) so the card can't read "-$0".
  const overchargeAmount = -Number(overcharge._sum.savingsAmount ?? 0) || 0
  const underchargeAmount = Number(undercharge._sum.savingsAmount ?? 0) || 0

  return serialize({
    totalDiscrepancies,
    // Both magnitudes are POSITIVE dollars; direction lives in the name.
    overcharges: {
      count: overcharge._count._all,
      amount: overchargeAmount,
    },
    undercharges: {
      count: undercharge._count._all,
      amount: underchargeAmount,
    },
    // Eliminating the overcharges is the recoverable money. Same scope,
    // same query family as the counts sitting beside it on the card.
    estimatedSavings: overchargeAmount,
    // Rows carrying no contract price (off-contract), or whose
    // savingsAmount enrichment suppressed as untrustworthy: counted in
    // the total, in neither dollar bucket. Surfaced so the three
    // facility-wide buckets reconcile to the total on the card rather
    // than silently failing to add up. Clamped at 0 — the count and the
    // two aggregates are three separate round trips, so a concurrent
    // import could otherwise make this read negative.
    withoutDollarImpact: Math.max(
      0,
      totalDiscrepancies - overcharge._count._all - undercharge._count._all,
    ),
    rowCap: PRICE_DISCREPANCY_ROW_CAP,
  })
}

/**
 * The report's row list. This is a display SAMPLE — the top
 * `PRICE_DISCREPANCY_ROW_CAP` rows by variance, not the facility's whole
 * discrepancy set. Any headline number must come from
 * `getPriceDiscrepancySummary()`, never from `rows.length` or a reduce
 * over this array; any surface that shows or exports these rows must say
 * how many of how many it is showing.
 *
 * The sample is BIASED, not merely short: the ordering below is
 * `variancePercent` DESC (nulls last) and variancePercent > 0 means the
 * facility OVERPAID, so the rows that survive the cap are the largest
 * overcharge percentages. Undercharges (negative variance) and
 * off-contract rows (null variance) are the first dropped. A severity
 * histogram, a per-vendor total, or a "% of lines that are major"
 * computed over this array is therefore wrong in a way that scales with
 * facility size — such surfaces must aggregate server-side.
 *
 * The two surfaces that need facility-wide numbers have their own
 * companion aggregates over the SAME `priceDiscrepancyWhere` set:
 * `getPriceDiscrepancySummary` (the line-item tab's four cards) and
 * `getPriceVarianceSeverityBreakdown` (the severity tab's cards, chart,
 * vendor table and major-line drill-down). Neither reduces this array.
 */
export async function getPriceDiscrepancies(_facilityId?: string) {
  const { facility } = await requireFacility()

  // Source of truth is the facility's matched spend (COGRecord), NOT
  // imported invoices. The contract match engine stamps each COG row's
  // matchStatus + contractPrice + variancePercent (lib/cog/enrichment.ts);
  // the SAME rows drive the off-contract / price-variance ALERTS
  // (lib/alerts/synthesizer.ts). Reading invoiceLineItem here meant the
  // report sat empty for facilities that import COG but not invoices,
  // even though the alerts had data. We surface:
  //   • price_variance    → on-contract item paid ≠ contract price (has %)
  //   • off_contract_item → bought off any contract (no contract price;
  //                          shows in the line-item detail as "No Contract")
  // Ordered by variance magnitude (off-contract rows, null %, sort last).
  const rows = await prisma.cOGRecord.findMany({
    where: priceDiscrepancyWhere(facility.id),
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: [
      { variancePercent: { sort: "desc", nulls: "last" } },
      { extendedPrice: { sort: "desc", nulls: "last" } },
    ],
    take: PRICE_DISCREPANCY_ROW_CAP,
  })

  return serialize(
    rows.map((r) => {
      const unitCost = Number(r.unitCost)
      return {
        id: r.id,
        // No invoice backs these — the PO number is the reference. Empty
        // invoiceId so the UI can omit the (nonexistent) invoice link.
        invoiceId: "",
        invoiceNumber: r.poNumber ?? "",
        vendorName: r.vendorName ?? r.vendor?.name ?? "Unknown vendor",
        vendorId: r.vendorId ?? r.vendor?.id ?? "",
        itemDescription: r.inventoryDescription,
        vendorItemNo: r.vendorItemNo,
        invoicePrice: unitCost,
        contractPrice: r.contractPrice != null ? Number(r.contractPrice) : null,
        variancePercent: r.variancePercent != null ? Number(r.variancePercent) : null,
        quantity: r.quantity,
        totalLineCost:
          r.extendedPrice != null ? Number(r.extendedPrice) : unitCost * r.quantity,
        isFlagged: false,
      }
    }),
  )
}

// ─── Price-variance severity breakdown ("By severity" tab) ───────

/**
 * Severity bands, expressed as Prisma predicates on
 * `COGRecord.variancePercent`, so the histogram is computed by Postgres
 * over the WHOLE qualifying set instead of by the client over the
 * 1,500-row sample.
 *
 * These MUST stay in lockstep with the `SEVERITY_META` labels the
 * dashboard prints on the cards
 * (`components/facility/reports/price-variance-dashboard.tsx`):
 * |variance%| < 2 minor, < 10 moderate, otherwise major — so the
 * boundaries are inclusive on the LOW side of moderate and major
 * (exactly 2 is moderate, exactly 10 is major). Bands are on the
 * ABSOLUTE variance: a −12% line (a deep discount) is as "major" as a
 * +12% one, which is why each band is a two-sided OR rather than a
 * single range.
 *
 * NULL `variancePercent` (every off-contract line — 39,031 of the
 * production snapshot's 44,812 qualifying rows) matches no band: SQL
 * comparisons against NULL are never true. Those lines are counted in
 * `totalLines` and reported as `unbandedLines` rather than silently
 * vanishing between the cards and the facility total.
 */
const SEVERITY_BAND_WHERE = {
  minor: { variancePercent: { gt: -2, lt: 2 } },
  moderate: {
    OR: [
      { variancePercent: { gte: 2, lt: 10 } },
      { variancePercent: { gt: -10, lte: -2 } },
    ],
  },
  major: {
    OR: [{ variancePercent: { gte: 10 } }, { variancePercent: { lte: -10 } }],
  },
} satisfies Record<string, Prisma.COGRecordWhereInput>

type PriceVarianceSeverity = keyof typeof SEVERITY_BAND_WHERE

/**
 * How many major-severity lines the drill-down table shows. This one IS
 * a top-N — a facility with 3,346 major lines does not want them all on
 * a report page — so the dashboard labels it ("Top 25 of 3,346") instead
 * of implying the list is exhaustive.
 */
const MAJOR_LINE_SAMPLE = 25

const MAJOR_LINE_SELECT = {
  id: true,
  poNumber: true,
  vendorId: true,
  vendorName: true,
  inventoryDescription: true,
  vendorItemNo: true,
  variancePercent: true,
  savingsAmount: true,
} satisfies Prisma.COGRecordSelect

const UNKNOWN_VENDOR = "Unknown vendor"

type SignedMoneyAggregate = {
  _sum: { savingsAmount: Prisma.Decimal | null }
  _count: { _all: number }
}

/**
 * Dollars for one severity band, split by direction and NEVER netted —
 * the same rule `getPriceDiscrepancySummary` follows. In the production
 * snapshot the major band carries $1,901,307 of overcharge AND
 * $4,176,877 of discount; netting them to "−$2.28M impact" would erase
 * the $1.9M that is actually recoverable.
 *
 * `savingsAmount` is `(contractPrice − unitCost) × quantity` — POSITIVE
 * when the facility paid LESS than contract — so the overcharge bucket
 * is the negated sum of the negative rows. `|| 0` normalizes the −0 that
 * negating 0 produces, so a card can never read "−$0".
 */
function priceVarianceBandBucket(
  lines: number,
  overcharge: SignedMoneyAggregate,
  undercharge: SignedMoneyAggregate,
) {
  return {
    lines,
    overchargeTotal: -Number(overcharge._sum.savingsAmount ?? 0) || 0,
    overchargeLines: overcharge._count._all,
    underchargeTotal: Number(undercharge._sum.savingsAmount ?? 0) || 0,
    underchargeLines: undercharge._count._all,
    // Banded lines carrying no dollar figure: enrichment nulls
    // `savingsAmount` when its kit-vs-component sanity check fires (199
    // rows in the production snapshot), and an exactly-at-contract line
    // sums to $0. Surfaced so `overchargeLines + underchargeLines +
    // withoutDollarImpact = lines` reconciles on the card. Clamped
    // because the three reads are separate round trips.
    withoutDollarImpact: Math.max(
      0,
      lines - overcharge._count._all - undercharge._count._all,
    ),
  }
}

/**
 * Facility-wide severity breakdown — the companion aggregate for the
 * Price Discrepancy report's DEFAULT tab, over the same
 * `priceDiscrepancyWhere` set as `getPriceDiscrepancies` and
 * `getPriceDiscrepancySummary`.
 *
 * WHY THIS EXISTS. `price-variance-dashboard.tsx` used to build its
 * severity cards, its severity chart, its per-vendor overcharge /
 * undercharge totals and its major-line drill-down by reducing over
 * `getPriceDiscrepancies()`, which stops at `PRICE_DISCREPANCY_ROW_CAP`
 * (1,500) rows ordered by variance % DESC. Measured 2026-07-28 against
 * the production snapshot's Lighthouse Surgical Center (44,812
 * qualifying rows), that reducer produced:
 *
 *   card       shown (capped sample)      truth (full set)
 *   Major      1,500 lines / +$1,295,024  3,346 lines / $1,901,307 over
 *                                                     + $4,176,877 under
 *   Moderate   0 lines / $0               2,435 lines / $5,684 over
 *                                                     + $65,662 under
 *   Minor      0 lines / $0               0 lines / $0
 *
 * — a major count that is exactly the cap, two cards reading zero for
 * 2,435 real lines, and a dollar figure with the wrong SIGN, because
 * variance-% DESC ordering keeps only the overcharge tail and drops
 * every discount. The dev seed (1,135 rows, under the cap) showed 973
 * major / $472,173 either way, which is why this never reproduced
 * locally.
 *
 * Every number here comes from Postgres over the full set: three
 * `count`s and six `aggregate`s for the bands, four `groupBy`s for the
 * vendor table, and two `findMany`s for the top-N drill-down (one per
 * direction, so the biggest discount can rank alongside the biggest
 * overcharge). All issued in one parallel batch — never one query per
 * band-and-vendor.
 *
 * The vendor list is NOT capped: it is one row per vendor (193 in the
 * production snapshot), a dimension bounded by the vendor table rather
 * than by the 44,812-row fact table. The dashboard renders a slice of it
 * and states what the slice leaves out, computing that remainder from
 * the full list it already holds.
 */
export async function getPriceVarianceSeverityBreakdown(_facilityId?: string) {
  const { facility } = await requireFacility()
  const where = priceDiscrepancyWhere(facility.id)

  const band = (severity: PriceVarianceSeverity): Prisma.COGRecordWhereInput => ({
    ...where,
    ...SEVERITY_BAND_WHERE[severity],
  })
  const signedTotal = (
    scope: Prisma.COGRecordWhereInput,
    direction: "overcharge" | "undercharge",
  ) =>
    prisma.cOGRecord.aggregate({
      where: {
        ...scope,
        savingsAmount: direction === "overcharge" ? { lt: 0 } : { gt: 0 },
      },
      _sum: { savingsAmount: true },
      _count: { _all: true },
    })

  const [
    totalLines,
    minorLines,
    moderateLines,
    majorLines,
    minorOver,
    minorUnder,
    moderateOver,
    moderateUnder,
    majorOver,
    majorUnder,
    overchargeByVendor,
    underchargeByVendor,
    linesByVendor,
    majorLinesByVendor,
    topOvercharges,
    topDiscounts,
  ] = await Promise.all([
    prisma.cOGRecord.count({ where }),
    prisma.cOGRecord.count({ where: band("minor") }),
    prisma.cOGRecord.count({ where: band("moderate") }),
    prisma.cOGRecord.count({ where: band("major") }),
    signedTotal(band("minor"), "overcharge"),
    signedTotal(band("minor"), "undercharge"),
    signedTotal(band("moderate"), "overcharge"),
    signedTotal(band("moderate"), "undercharge"),
    signedTotal(band("major"), "overcharge"),
    signedTotal(band("major"), "undercharge"),
    prisma.cOGRecord.groupBy({
      by: ["vendorId"],
      where: { ...where, savingsAmount: { lt: 0 } },
      _sum: { savingsAmount: true },
      _count: { _all: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorId"],
      where: { ...where, savingsAmount: { gt: 0 } },
      _sum: { savingsAmount: true },
      _count: { _all: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorId"],
      where,
      _count: { _all: true },
    }),
    prisma.cOGRecord.groupBy({
      by: ["vendorId"],
      where: band("major"),
      _count: { _all: true },
    }),
    // Top-N by dollar impact, both directions. `savingsAmount` ASC is
    // the biggest overcharge (most negative), DESC the biggest discount;
    // Prisma cannot ORDER BY abs(), so we take the extremes from each
    // end and merge. Nulls sort last either way and carry $0 impact, so
    // they can never displace a real line.
    prisma.cOGRecord.findMany({
      where: { ...band("major"), savingsAmount: { lt: 0 } },
      select: MAJOR_LINE_SELECT,
      orderBy: { savingsAmount: "asc" },
      take: MAJOR_LINE_SAMPLE,
    }),
    prisma.cOGRecord.findMany({
      where: { ...band("major"), savingsAmount: { gt: 0 } },
      select: MAJOR_LINE_SELECT,
      orderBy: { savingsAmount: "desc" },
      take: MAJOR_LINE_SAMPLE,
    }),
  ])

  // Vendor display names come from the Vendor table, not from
  // `COGRecord.vendorName`: that column is free text off the import and
  // the production snapshot already has one vendorId carrying two
  // spellings, which would split a vendor into two rows if it were part
  // of the groupBy key. The ids are derived from this facility's own
  // rows, never from the caller.
  const vendorIds = [
    ...new Set(
      [
        ...overchargeByVendor,
        ...underchargeByVendor,
        ...linesByVendor,
        ...majorLinesByVendor,
      ]
        .map((group) => group.vendorId)
        .filter((id): id is string => id != null),
    ),
  ]
  const vendorRecords = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: { id: true, name: true },
      })
    : []
  const vendorNameById = new Map(vendorRecords.map((v) => [v.id, v.name]))
  const nameFor = (vendorId: string | null, fallback?: string | null) =>
    (vendorId ? vendorNameById.get(vendorId) : null) ??
    fallback ??
    UNKNOWN_VENDOR

  type VendorBucket = {
    vendorId: string
    vendorName: string
    overchargeTotal: number
    overchargeLines: number
    underchargeTotal: number
    underchargeLines: number
    lines: number
    majorLines: number
  }
  const vendorBuckets = new Map<string, VendorBucket>()
  const bucketFor = (vendorId: string | null): VendorBucket => {
    // Rows with no linked vendor collapse into one "Unknown vendor"
    // bucket rather than disappearing.
    const key = vendorId ?? ""
    const existing = vendorBuckets.get(key)
    if (existing) return existing
    const created: VendorBucket = {
      vendorId: key,
      vendorName: nameFor(vendorId),
      overchargeTotal: 0,
      overchargeLines: 0,
      underchargeTotal: 0,
      underchargeLines: 0,
      lines: 0,
      majorLines: 0,
    }
    vendorBuckets.set(key, created)
    return created
  }

  for (const group of linesByVendor) {
    bucketFor(group.vendorId).lines = group._count._all
  }
  for (const group of overchargeByVendor) {
    const bucket = bucketFor(group.vendorId)
    bucket.overchargeTotal = -Number(group._sum.savingsAmount ?? 0) || 0
    bucket.overchargeLines = group._count._all
  }
  for (const group of underchargeByVendor) {
    const bucket = bucketFor(group.vendorId)
    bucket.underchargeTotal = Number(group._sum.savingsAmount ?? 0) || 0
    bucket.underchargeLines = group._count._all
  }
  for (const group of majorLinesByVendor) {
    bucketFor(group.vendorId).majorLines = group._count._all
  }

  const vendors = [...vendorBuckets.values()].sort(
    (a, b) =>
      b.overchargeTotal - a.overchargeTotal ||
      b.majorLines - a.majorLines ||
      b.lines - a.lines ||
      a.vendorName.localeCompare(b.vendorName),
  )

  const majorLineSample = [...topOvercharges, ...topDiscounts]
    .map((r) => ({
      id: r.id,
      // No invoice backs a COG line — the PO number is the reference.
      reference: r.poNumber ?? "",
      vendorId: r.vendorId ?? "",
      vendorName: nameFor(r.vendorId, r.vendorName),
      itemDescription: r.inventoryDescription,
      vendorItemNo: r.vendorItemNo,
      variancePercent:
        r.variancePercent != null ? Number(r.variancePercent) : null,
      // POSITIVE = the facility overpaid, matching variancePercent's sign.
      dollarImpact: -Number(r.savingsAmount ?? 0) || 0,
    }))
    .sort((a, b) => Math.abs(b.dollarImpact) - Math.abs(a.dollarImpact))
    .slice(0, MAJOR_LINE_SAMPLE)

  return serialize({
    totalLines,
    bands: {
      minor: priceVarianceBandBucket(minorLines, minorOver, minorUnder),
      moderate: priceVarianceBandBucket(
        moderateLines,
        moderateOver,
        moderateUnder,
      ),
      major: priceVarianceBandBucket(majorLines, majorOver, majorUnder),
    },
    // Off-contract lines: no contract price, so no variance % and no
    // band. Counted in `totalLines`, named here so the three cards plus
    // this number reconcile to the facility total instead of leaving
    // 87% of the report's rows unaccounted for.
    unbandedLines: Math.max(
      0,
      totalLines - minorLines - moderateLines - majorLines,
    ),
    vendors,
    majorLineSample,
    majorLineSampleSize: MAJOR_LINE_SAMPLE,
  })
}
