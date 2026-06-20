"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { computeSyntheticContractPeriods } from "@/lib/actions/contract-periods"

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
      rebates: {
        where: {
          payPeriodStart: { gte: new Date(dateFrom) },
          payPeriodEnd: { lte: new Date(dateTo) },
        },
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

  // Per-period shape the report tabs (reports-per-type-tab / report-period-table
  // → ContractPeriodRow) consume. Built from persisted ContractPeriod rows
  // when present, otherwise from the synthetic COG-derived fallback.
  interface ReportPeriodRow {
    id: string
    periodStart: string
    periodEnd: string
    totalSpend: number
    totalVolume: number
    rebateEarned: number
    rebateCollected: number
    paymentExpected: number
    paymentActual: number
    tierAchieved: number | null
  }

  // 2026-06-18 perf audit: fetch the facility COG-category universe ONCE (it's
  // facility-scoped, identical across all contracts) and thread it into the
  // per-contract synthetic-period fallback below — instead of that fallback
  // re-running a full-COG groupBy per contract (the N+1 worst case on
  // freshly-imported facilities with no persisted ContractPeriod rollups).
  const { facilityCogCategoryUniverse } = await import(
    "@/lib/contracts/cog-category-universe"
  )
  const reportsCogUniverse = await facilityCogCategoryUniverse(facilityId)

  const contractRows = await Promise.all(
    contracts.map(async (c) => {
      const rebateEarnedCanonical = sumEarnedRebatesLifetime(
        c.rebates,
        windowEnd,
      )
      // Margin = canonical earned rebate − payments actually made over
      // the returned periods. For usage/pricing/grouped contracts (no
      // payment ledger) the payment sum is 0, so margin === earned.
      const paymentActualSum = c.periods.reduce(
        (s, p) => s + Number(p.paymentActual),
        0,
      )

      // Per-period rows: prefer persisted ContractPeriod; when a contract
      // has ZERO persisted periods (the facility-Reports-empty bug), fall
      // back to the same COG-derived synthetic periods the vendor /
      // Transactions surfaces use, filtered to the requested window (the
      // persisted path filters via the Prisma `where` on periodStart/
      // periodEnd — we replicate that filter here on the synthetic rows).
      // Charles 2026-06-20 ("not all the numbers for this contract are coming
      // up in reports"): exclude payment/credit-shaped legacy ContractPeriod
      // rows (totalSpend=0 ∧ rebateEarned=0 ∧ paymentActual>0, a single-day
      // window) from the spend/rebate period set. Those are stray logged
      // payments (pre-PR#72 storage); leaving them in made a contract with one
      // such row take the persisted branch and render ONLY that $0-spend row,
      // hiding the real COG-derived spend + rebate (the synthetic fallback
      // below produces it).
      const spendPeriods = c.periods.filter(
        (p) =>
          !(
            Number(p.totalSpend) === 0 &&
            Number(p.rebateEarned) === 0 &&
            Number(p.paymentActual) > 0
          ),
      )
      let periodRows: ReportPeriodRow[]
      if (spendPeriods.length > 0) {
        periodRows = spendPeriods.map((p) => ({
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
        }))
      } else {
        const synthetic = await computeSyntheticContractPeriods(
          c,
          facilityId,
          reportsCogUniverse,
        )
        periodRows = synthetic
          .filter(
            (p) => p.periodStart >= windowStart && p.periodEnd <= windowEnd,
          )
          .map((p) => ({
            id: p.id,
            periodStart: p.periodStart.toISOString(),
            periodEnd: p.periodEnd.toISOString(),
            // Synthetic rows carry real per-month spend, rebate earned, and
            // tier; fields they cannot derive (volume, collected, payments)
            // are 0 — the canonical Rebate-table totals below remain the
            // source of truth for earned/collected aggregates.
            totalSpend: p.totalSpend,
            totalVolume: 0,
            rebateEarned: p.rebateEarned,
            rebateCollected: 0,
            paymentExpected: 0,
            paymentActual: 0,
            tierAchieved: p.tierAchieved,
          }))
      }

      return {
        id: c.id,
        name: c.name,
        // Contract identifier for display — may be null, callers fall
        // back to `name`.
        contractNumber: c.contractNumber,
        vendor: c.vendor.name,
        vendorId: c.vendor.id,
        contractType: c.contractType,
        effectiveDate: c.effectiveDate.toISOString(),
        expirationDate: c.expirationDate.toISOString(),
        totalValue: Number(c.totalValue),
        // Canonical per-contract rebate totals over the report window.
        // These are what all downstream tabs should display — the raw
        // `periods[].rebateEarned/Collected` reducers drift.
        rebateEarnedCanonical,
        rebateCollectedCanonical: sumCollectedRebates(c.rebates),
        marginCanonical: rebateEarnedCanonical - paymentActualSum,
        periods: periodRows,
      }
    }),
  )

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
  await requireFacility()
  const { contractId, dateFrom, dateTo } = input

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
