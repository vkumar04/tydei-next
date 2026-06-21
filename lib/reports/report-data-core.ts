/**
 * Reports hub — "Contract Performance Details" per-contract row core.
 *
 * Shared by the facility action `getReportData` (`lib/actions/reports.ts`)
 * and its vendor mirror `getVendorReportData`
 * (`lib/actions/vendor-reports/report-data.ts`). The two actions are
 * byte-identical except for the auth gate, the contract `where` scope, the
 * synthetic-period COG scope (facility id), the capital-balance helper
 * (facility-gated `getContractCapitalSchedule` vs vendor
 * `getVendorContractCapitalBalance`), and the top-level `facilityName`.
 *
 * The action layer owns ONLY the gate + scoped fetch; it passes the
 * already-loaded (tenant-scoped) contracts in, plus two injected async
 * callbacks the wrapper binds to its own scope:
 *   - `computeSynthetic(contract)` → the COG-derived synthetic periods for
 *     the per-month fallback (each wrapper scopes COG by the right
 *     facility id), or `null` when the contract can't be synthesized.
 *   - `resolveCapital(contract)` → the capital-balance trio for
 *     capital/tie_in contracts (each portal uses its own gated helper), or
 *     `null` to omit the capital row.
 *
 * Tenant scope is NEVER hidden inside this core.
 */
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

// Per-period shape the report tabs (reports-per-type-tab /
// report-period-table → ContractPeriodRow) consume. Built from persisted
// ContractPeriod rows when present, otherwise from the synthetic
// COG-derived fallback.
export interface ReportPeriodRow {
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

/** Minimal ContractPeriod shape the core reads. */
export interface PeriodRowInput {
  id: string
  periodStart: Date
  periodEnd: Date
  totalSpend: { toString(): string } | number
  totalVolume: number
  rebateEarned: { toString(): string } | number
  rebateCollected: { toString(): string } | number
  paymentExpected: { toString(): string } | number
  paymentActual: { toString(): string } | number
  tierAchieved: number | null
}

/** A COG-derived synthetic period (subset the report row maps from). */
export interface SyntheticPeriod {
  id: string
  periodStart: Date
  periodEnd: Date
  totalSpend: number
  rebateEarned: number
  tierAchieved: number | null
}

/** Minimal Rebate shape the canonical totals read. */
export interface RebateRowInput {
  payPeriodEnd: Date
  rebateEarned: { toString(): string } | number | string | null | undefined
  collectionDate: Date | string | null | undefined
  rebateCollected:
    | { toString(): string }
    | number
    | string
    | null
    | undefined
}

/** Minimal Contract shape the report-data core reads. */
export interface ReportDataContract {
  id: string
  name: string
  contractNumber: string | null
  contractType: string
  effectiveDate: Date
  expirationDate: Date
  totalValue: { toString(): string } | number
  vendor: { id: string; name: string }
  periods: PeriodRowInput[]
  rebates: RebateRowInput[]
}

export interface CapitalBalance {
  capitalCost: number
  paidToDate: number
  remainingBalance: number
}

export interface ReportDataRow {
  id: string
  name: string
  contractNumber: string | null
  vendor: string
  vendorId: string
  contractType: string
  effectiveDate: string
  expirationDate: string
  totalValue: number
  rebateEarnedCanonical: number
  rebateCollectedCanonical: number
  marginCanonical: number
  capitalCost: number | null
  capitalPaidToDate: number | null
  capitalRemainingBalance: number | null
  periods: ReportPeriodRow[]
}

/**
 * Build the per-contract report rows from already-fetched, tenant-scoped
 * contracts. `windowStart` / `windowEnd` are the report's date bounds (the
 * synthetic-period fallback is filtered to this window, mirroring the
 * persisted path's Prisma `where`). `computeSynthetic` and `resolveCapital`
 * are injected so each wrapper keeps its scope (see module doc).
 */
export async function buildReportDataRows<T extends ReportDataContract>(input: {
  contracts: T[]
  windowStart: Date
  windowEnd: Date
  computeSynthetic: (contract: T) => Promise<SyntheticPeriod[] | null>
  resolveCapital: (contract: T) => Promise<CapitalBalance | null>
}): Promise<ReportDataRow[]> {
  const { contracts, windowStart, windowEnd, computeSynthetic, resolveCapital } =
    input

  return Promise.all(
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
      // has ZERO persisted periods, fall back to the COG-derived synthetic
      // periods, filtered to the requested window (the persisted path
      // filters via the Prisma `where` on periodStart/periodEnd — we
      // replicate that filter here on the synthetic rows).
      // Charles 2026-06-20: exclude payment/credit-shaped legacy
      // ContractPeriod rows (totalSpend=0 ∧ rebateEarned=0 ∧
      // paymentActual>0, a single-day window) from the spend/rebate set —
      // those are stray logged payments (pre-PR#72 storage); leaving them
      // in hid the real COG-derived spend + rebate.
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
      } else {
        const synthetic = await computeSynthetic(c)
        if (synthetic) {
          periodRows = synthetic
            .filter(
              (p) => p.periodStart >= windowStart && p.periodEnd <= windowEnd,
            )
            .map((p) => ({
              id: p.id,
              periodStart: p.periodStart.toISOString(),
              periodEnd: p.periodEnd.toISOString(),
              // Synthetic rows carry real per-month spend, rebate earned,
              // and tier; fields they cannot derive (volume, collected,
              // payments) are 0 — the canonical Rebate-table totals below
              // remain the source of truth for earned/collected aggregates.
              totalSpend: p.totalSpend,
              totalVolume: 0,
              rebateEarned: p.rebateEarned,
              rebateCollected: 0,
              paymentExpected: 0,
              paymentActual: 0,
              tierAchieved: p.tierAchieved,
            }))
        }
      }

      // Capital balance for capital/tie-in contracts (Charles 2026-06-20
      // "the balances are not coming in"). Best-effort: a failure leaves
      // nulls and the header simply omits the capital balance row.
      let capitalCost: number | null = null
      let capitalPaidToDate: number | null = null
      let capitalRemainingBalance: number | null = null
      if (c.contractType === "capital" || c.contractType === "tie_in") {
        try {
          const bal = await resolveCapital(c)
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
}
