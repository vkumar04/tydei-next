"use server"

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { computeSyntheticContractPeriods } from "@/lib/actions/contract-periods"
import { buildReportDataRows } from "@/lib/reports/report-data-core"
import {
  contractsOwnedByVendor,
  contractOwnershipWhereVendor,
  scopeContractWhereToFacility,
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
//   3. `facilityName` is "All Facilities" when unfiltered — vendor reports
//      span every facility the vendor's contracts belong to. When the
//      optional `facilityId` filter is set (Reports Hub facility selector),
//      the rows are narrowed to that facility and the header shows its name
//      (derived from the matched rows — never a separate facility read, so
//      no cross-tenant name leak).
//   4. The synthetic-period COG fallback is scoped to EACH CONTRACT'S OWN
//      `facilityId` (COG is per-facility; a contract belongs to exactly
//      one facility) — never the vendor id.

export async function getVendorReportData(input: {
  vendorId?: string
  reportType: "usage" | "service" | "tie_in" | "capital" | "grouped"
  dateFrom: string
  dateTo: string
  facilityId?: string
}) {
  const { vendor } = await requireVendor()
  const { reportType, dateFrom, dateTo, facilityId } = input

  const contracts = await prisma.contract.findMany({
    where: {
      ...scopeContractWhereToFacility(
        contractsOwnedByVendor(vendor.id),
        facilityId,
      ),
      contractType: reportType === "grouped" ? "grouped" : reportType,
      status: { in: ["active", "expiring"] },
    },
    include: {
      vendor: { select: { id: true, name: true } },
      // Facility name powers the report header band when a single facility
      // is selected (derived from the rows the vendor already owns).
      facility: { select: { name: true } },
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

  // 2026-06-18 perf audit: the synthetic-period fallback runs a full-COG
  // groupBy per contract. Vendor contracts span multiple facilities, so
  // fetch each DISTINCT facility's COG-category universe ONCE up front
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

  // Per-contract row assembly lives in the shared pure core
  // `buildReportDataRows` (lib/reports/report-data-core.ts), which the
  // facility original also uses so the two surfaces can never drift. The
  // vendor wrapper injects its own per-facility synthetic-period fallback
  // and the vendor-scoped capital balance.
  const contractRows = await buildReportDataRows({
    contracts,
    windowStart,
    windowEnd,
    // COG is per-facility, so the synthetic fallback is scoped to the
    // contract's OWN facilityId, never the vendor id. A facility-less
    // contract has no COG to synthesize from → return null so the core
    // leaves periods empty (mirrors the original `else if (c.facilityId)`).
    computeSynthetic: (c) =>
      c.facilityId
        ? computeSyntheticContractPeriods(
            c,
            c.facilityId,
            universeByFacility.get(c.facilityId),
          )
        : Promise.resolve(null),
    // Vendor-scoped capital balance — the facility action can't run under a
    // vendor session.
    resolveCapital: (c) => getVendorContractCapitalBalance(c.id, vendor.id),
  })

  // Unfiltered → "All Facilities"; filtered → the selected facility's name,
  // read off the matched rows (which the vendor already owns) so we never
  // do an unscoped facility lookup. Falls back to "Selected Facility" only
  // if the filter matched zero contracts (empty-state header).
  const isFacilityFiltered = Boolean(facilityId && facilityId !== "all")
  const facilityName = isFacilityFiltered
    ? (contracts.find((c) => c.facility?.name)?.facility?.name ??
      "Selected Facility")
    : "All Facilities"

  return serialize({
    facilityName,
    contracts: contractRows,
    reportType,
    dateFrom,
    dateTo,
  })
}
