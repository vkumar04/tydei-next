"use server"

import { prisma } from "@/lib/db"
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
    where: {
      facilityId: facility.id,
      matchStatus: { in: ["price_variance", "off_contract_item"] },
    },
    include: { vendor: { select: { id: true, name: true } } },
    orderBy: [
      { variancePercent: { sort: "desc", nulls: "last" } },
      { extendedPrice: { sort: "desc", nulls: "last" } },
    ],
    take: 1500,
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
