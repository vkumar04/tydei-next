"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { computeSyntheticContractPeriods } from "@/lib/actions/contract-periods"
import {
  contractsOwnedByVendor,
  contractOwnershipWhereVendor,
} from "@/lib/actions/contracts-vendor-auth"
import {
  normalizeCapitalLineItems,
  sumCapitalCost,
  sumFinancedPrincipal,
} from "@/lib/contracts/capital-line-items"
import { sumRebateAppliedToCapital } from "@/lib/contracts/rebate-capital-filter"

// Vendor-scoped capital balance for capital/tie_in contracts. Mirrors the
// capitalCost / paidToDate / remainingBalance trio that `getReportData`
// (lib/actions/reports.ts) sources from the facility-gated
// `getContractCapitalSchedule` — but that action gates with
// `requireFacility()` + facility ownership, so it can't run under a vendor
// session. This recomputes ONLY those three fields from the same inputs
// (capital line items or the capital totalValue fallback; rebate applied via
// `sumRebateAppliedToCapital`; logged payments + credits), scoped to a
// contract owned by / grouped with the vendor. Best-effort: a failure leaves
// nulls and the header simply omits the capital row.
async function getVendorContractCapitalBalance(
  contractId: string,
  vendorId: string,
): Promise<{
  capitalCost: number
  paidToDate: number
  remainingBalance: number
} | null> {
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhereVendor(contractId, vendorId),
    select: {
      id: true,
      name: true,
      contractType: true,
      facilityId: true,
      totalValue: true,
      capitalLineItems: { orderBy: { createdAt: "asc" } },
      payments: { select: { paymentAmount: true } },
      creditEntries: { select: { creditAmount: true } },
      rebates: { select: { collectionDate: true, rebateCollected: true } },
    },
  })
  if (!contract) return null

  // Logged payments + credits pay down capital regardless of a financing
  // schedule (mirrors the facility action).
  const paymentsAppliedToCapital =
    contract.payments.reduce((s, p) => s + Number(p.paymentAmount), 0) +
    contract.creditEntries.reduce((s, c) => s + Number(c.creditAmount), 0)

  const lineItems = normalizeCapitalLineItems(contract)

  if (lineItems.length === 0) {
    // No per-asset line items: only a pure `capital` contract uses
    // totalValue as the capital cost (a tie_in's totalValue is a commitment
    // ceiling, not capital). `!(x > 0)` also rejects NaN.
    const capitalCost =
      contract.contractType === "capital" ? Number(contract.totalValue) : 0
    if (!(capitalCost > 0)) return null
    const rebateAppliedToCapital = sumRebateAppliedToCapital(
      contract.rebates,
      contract.contractType === "capital" ? "tie_in" : contract.contractType,
    )
    const paidToDate = rebateAppliedToCapital + paymentsAppliedToCapital
    return {
      capitalCost,
      paidToDate,
      remainingBalance: Math.max(0, capitalCost - paidToDate),
    }
  }

  const capitalCost = sumCapitalCost(lineItems)
  const financedPrincipal = sumFinancedPrincipal(lineItems)
  if (financedPrincipal <= 0) return null

  // Combine own + sibling rebates: a separate-row `capital` contract is paid
  // down by the usage contracts that point at it via tieInCapitalContractId
  // (scoped to the contract's own facility — COG/rebate are per-facility).
  const isCapital = contract.contractType === "capital"
  const isTieIn = contract.contractType === "tie_in"
  const allRebates = isTieIn ? [...contract.rebates] : []
  if (isCapital) {
    const siblingRebates = await prisma.rebate.findMany({
      where: {
        contract: {
          tieInCapitalContractId: contract.id,
          facilityId: contract.facilityId,
        },
      },
      select: { collectionDate: true, rebateCollected: true },
    })
    allRebates.push(...siblingRebates)
    if (contract.rebates.length > 0) allRebates.push(...contract.rebates)
  }
  const rebateAppliedToCapital = sumRebateAppliedToCapital(
    allRebates,
    isCapital ? "tie_in" : contract.contractType,
  )
  const paidToDate = rebateAppliedToCapital + paymentsAppliedToCapital
  return {
    capitalCost,
    paidToDate,
    remainingBalance: Math.max(0, financedPrincipal - paidToDate),
  }
}

// ─── Vendor Report Data ──────────────────────────────────────────
//
// Vendor-scoped mirror of `getReportData` in `lib/actions/reports.ts`.
// Returns the BYTE-IDENTICAL payload shape the facility action returns so
// the shared presentational components (reports-per-type-tab /
// report-period-table → ContractPeriodRow, Contract Performance Details
// header band) can consume vendor reports without modification.
//
// Differences from the facility original:
//   1. Gated with `requireVendor()` — scope is the session vendor, NOT a
//      facility. The optional `vendorId` input is ignored for auth,
//      mirroring how `getReportData` ignores its `facilityId` param.
//   2. Contracts scoped via `contractsOwnedByVendor(vendor.id)` — covers
//      both the primary `vendorId` AND grouped `additionalVendorIds`
//      membership (group-vendor-drift class). NEVER hand-roll the OR.
//   3. `facilityName` is "All Facilities" — vendor reports span every
//      facility the vendor's contracts belong to.
//   4. The synthetic-period COG fallback is scoped to EACH CONTRACT'S OWN
//      `facilityId` (COG is per-facility; a contract belongs to exactly
//      one facility) — never the vendor id.

export async function getVendorReportData(input: {
  vendorId?: string
  reportType: "usage" | "service" | "tie_in" | "capital" | "grouped"
  dateFrom: string
  dateTo: string
}) {
  const { vendor } = await requireVendor()
  const { reportType, dateFrom, dateTo } = input

  const contracts = await prisma.contract.findMany({
    where: {
      ...contractsOwnedByVendor(vendor.id),
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
      // Canonical rebate totals on Reports surfaces must come from the
      // Rebate table via sumEarnedRebatesLifetime / sumCollectedRebates,
      // not from raw `ContractPeriod.rebateEarned/Collected`.
      // ContractPeriod is a monthly rollup that can drift from the Rebate
      // ledger (manual rebate entries, out-of-band collections,
      // auto-accrual tie-in stamps). Fetching the rebate rows here and
      // returning them alongside the periods lets the tabs display
      // ContractPeriod rollups for the per-month ledger AND render
      // canonical totals computed from the Rebate table.
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

  // 2026-06-18 perf audit: the synthetic-period fallback below runs a
  // full-COG groupBy per contract. Vendor contracts span multiple facilities,
  // so fetch each DISTINCT facility's COG-category universe ONCE up front
  // (usually 1–3 facilities) and reuse it — turning N full-COG groupBys into
  // D, where D = distinct facilities.
  const { facilityCogCategoryUniverse } = await import(
    "@/lib/contracts/cog-category-universe"
  )
  const distinctFacilityIds = [
    ...new Set(
      contracts
        .map((c) => c.facilityId)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ]
  const universeByFacility = new Map<string, string[]>()
  await Promise.all(
    distinctFacilityIds.map(async (fid) => {
      universeByFacility.set(fid, await facilityCogCategoryUniverse(fid))
    }),
  )

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
      // has ZERO persisted periods, fall back to the same COG-derived
      // synthetic periods the vendor / Transactions surfaces use, filtered
      // to the requested window (the persisted path filters via the Prisma
      // `where` on periodStart/periodEnd — we replicate that filter here on
      // the synthetic rows). COG is per-facility, so the fallback is scoped
      // to the contract's OWN facilityId, never the vendor id.
      // Exclude payment/credit-shaped legacy ContractPeriod rows so the real
      // spend/rebate periods (or synthetic fallback) surface — same fix as the
      // facility report (Charles 2026-06-20).
      const spendPeriods = c.periods.filter(
        (p) =>
          !(
            Number(p.totalSpend) === 0 &&
            Number(p.rebateEarned) === 0 &&
            Number(p.paymentActual) > 0
          ),
      )
      let periodRows: ReportPeriodRow[] = []
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
      } else if (c.facilityId) {
        // Synthetic-period fallback scopes COG per-facility, so it needs
        // the contract's own facilityId (nullable on the vendor side —
        // a facility-less contract has no COG to synthesize from).
        const synthetic = await computeSyntheticContractPeriods(
          c,
          c.facilityId,
          universeByFacility.get(c.facilityId),
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

      // Capital balance for capital/tie-in contracts — mirrors the facility
      // report (Charles 2026-06-20 "the balances are not coming in"). Vendor-
      // scoped because the facility action can't run under a vendor session.
      let capitalCost: number | null = null
      let capitalPaidToDate: number | null = null
      let capitalRemainingBalance: number | null = null
      if (c.contractType === "capital" || c.contractType === "tie_in") {
        try {
          const bal = await getVendorContractCapitalBalance(c.id, vendor.id)
          if (bal && bal.capitalCost > 0) {
            capitalCost = bal.capitalCost
            capitalPaidToDate = bal.paidToDate
            capitalRemainingBalance = bal.remainingBalance
          }
        } catch {
          // leave nulls — header simply omits the capital balance row
        }
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
        // Capital balance trio (null for non-capital contracts).
        capitalCost,
        capitalPaidToDate,
        capitalRemainingBalance,
        periods: periodRows,
      }
    }),
  )

  return serialize({
    // Vendor reports span every facility the vendor's contracts belong
    // to, so the header band shows "All Facilities" rather than a single
    // facility name (the facility original surfaces `facility.name`).
    facilityName: "All Facilities",
    contracts: contractRows,
    reportType,
    dateFrom,
    dateTo,
  })
}
