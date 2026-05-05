"use server"

/**
 * Case-costing — true-margin reports server action.
 *
 * Wires the canonical `allocateRebatesToProcedures` helper
 * (`lib/contracts/true-margin.ts`) into the case-costing reports
 * surface. Per-procedure margin gets a proportional slice of each
 * vendor's earned rebates for the period, attributed by the
 * procedure's share of that vendor's spend.
 *
 * Inputs:
 *   - facilityId: scoping key (passed through `requireFacility`).
 *   - periodStart / periodEnd: ISO date strings (YYYY-MM-DD). Cases
 *     are bucketed by `dateOfSurgery`; rebates are bucketed by
 *     `payPeriodEnd`. Both buckets share the same window.
 *
 * Per-vendor rebate dollars are sourced through the canonical
 * `sumEarnedRebatesLifetime` helper, restricted to the requested
 * window via the helper's `today` override (treats the period end
 * as "today") + a manual lower-bound filter on `payPeriodEnd`.
 *
 * Vendor attribution per procedure comes from `CaseSupply` rows that
 * carry `contractId` (links to a Contract → Vendor). Off-contract
 * supplies are bucketed under `__off_contract__` and contribute no
 * rebate; on-contract supplies feed the per-vendor share denominator.
 *
 * Output is plain JSON (Decimal → number) — safe to ship over the
 * server-action boundary.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { allocateRebatesToProcedures } from "@/lib/contracts/true-margin"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"

// ─── Types ──────────────────────────────────────────────────────

export interface TrueMarginProcedureRow {
  procedureId: string
  procedureName: string
  caseNumber: string
  totalRevenue: number
  directCost: number
  rebateAllocation: number
  effectiveCost: number
  standardMargin: number
  trueMargin: number
  standardMarginPercent: number | null
  trueMarginPercent: number | null
  marginImprovementPercent: number | null
}

export interface TrueMarginVendorRow {
  vendorId: string
  vendorName: string
  totalSpend: number
  earnedRebate: number
}

export interface TrueMarginSummary {
  totalRevenue: number
  totalDirectCost: number
  totalRebateAllocation: number
  totalEffectiveCost: number
  standardMargin: number
  trueMargin: number
  standardMarginPercent: number | null
  trueMarginPercent: number | null
  marginImprovementPercent: number | null
}

export interface TrueMarginReport {
  periodStart: string
  periodEnd: string
  summary: TrueMarginSummary
  procedures: TrueMarginProcedureRow[]
  vendors: TrueMarginVendorRow[]
}

export interface GetTrueMarginReportInput {
  facilityId?: string
  periodStart: string
  periodEnd: string
}

// ─── Helpers ────────────────────────────────────────────────────

const OFF_CONTRACT_VENDOR_KEY = "__off_contract__"

function parseDateOrThrow(label: string, value: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`getTrueMarginReport: invalid ${label} (${value})`)
  }
  return d
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return (numerator / denominator) * 100
}

// ─── Action ─────────────────────────────────────────────────────

/**
 * Build a true-margin report for a facility over a date window.
 *
 * The math:
 *   1. Pull every Case in [periodStart, periodEnd] with its supplies
 *      (each supply may carry contractId → Contract → vendorId).
 *   2. Group supply spend per (case, vendor) — a procedure here
 *      means an individual case row, since a Case can collapse
 *      multiple CPTs but the per-case P&L is the unit users want.
 *   3. For each vendor that appears, sum earned rebates from
 *      `Rebate` rows whose `payPeriodEnd` falls in the window.
 *   4. For each vendor: call `allocateRebatesToProcedures` to
 *      distribute that vendor's earned rebate across the procedures
 *      that drove its spend, proportional to spend share.
 *   5. Sum per-procedure rebate slices into a per-procedure row;
 *      compute standard vs true margin off the case totals.
 */
export async function getTrueMarginReport(
  input: GetTrueMarginReportInput,
): Promise<TrueMarginReport> {
  const { facility } = await requireFacility()

  const periodStart = parseDateOrThrow("periodStart", input.periodStart)
  const periodEnd = parseDateOrThrow("periodEnd", input.periodEnd)

  // 1. Load cases + supplies in the window.
  const cases = await prisma.case.findMany({
    where: {
      facilityId: facility.id,
      dateOfSurgery: { gte: periodStart, lte: periodEnd },
    },
    include: {
      supplies: {
        select: {
          extendedCost: true,
          contractId: true,
          isOnContract: true,
        },
      },
    },
    orderBy: { dateOfSurgery: "asc" },
  })

  // 2. Resolve contractId → vendorId via a single batched lookup.
  const contractIds = new Set<string>()
  for (const c of cases) {
    for (const s of c.supplies) {
      if (s.contractId) contractIds.add(s.contractId)
    }
  }

  const contracts =
    contractIds.size === 0
      ? []
      : await prisma.contract.findMany({
          where: { id: { in: Array.from(contractIds) } },
          select: {
            id: true,
            vendorId: true,
            vendor: { select: { id: true, name: true } },
          },
        })

  const contractToVendor = new Map<
    string,
    { vendorId: string; vendorName: string }
  >()
  for (const c of contracts) {
    contractToVendor.set(c.id, {
      vendorId: c.vendor.id,
      vendorName: c.vendor.name,
    })
  }

  // 3. Build per-vendor spend map AND per-procedure-vendor spend.
  // procedureSpend[vendorId] = ProcedureSpend[] for the helper.
  // Each procedure row uses a synthetic id `${caseId}::${vendorId}`
  // so the same case can carry independent slices from multiple
  // vendors without collisions.
  interface CaseAggregate {
    caseId: string
    caseNumber: string
    procedureName: string
    totalRevenue: number
    directCost: number
    /** vendorId -> dollars */
    vendorSpend: Map<string, number>
  }

  const caseAggMap = new Map<string, CaseAggregate>()
  const vendorSpendTotal = new Map<string, number>()
  const vendorNameMap = new Map<string, string>()

  for (const c of cases) {
    const agg: CaseAggregate = {
      caseId: c.id,
      caseNumber: c.caseNumber,
      procedureName: c.primaryCptCode
        ? `${c.primaryCptCode} — ${c.surgeonName ?? "Unknown"}`
        : `Case ${c.caseNumber}`,
      totalRevenue: Number(c.totalReimbursement),
      directCost: Number(c.totalSpend),
      vendorSpend: new Map(),
    }

    for (const s of c.supplies) {
      const ext = Number(s.extendedCost)
      if (ext <= 0) continue

      let vendorId = OFF_CONTRACT_VENDOR_KEY
      let vendorName = "Off-contract / unknown"
      if (s.contractId) {
        const v = contractToVendor.get(s.contractId)
        if (v) {
          vendorId = v.vendorId
          vendorName = v.vendorName
        }
      }

      agg.vendorSpend.set(vendorId, (agg.vendorSpend.get(vendorId) ?? 0) + ext)
      vendorSpendTotal.set(
        vendorId,
        (vendorSpendTotal.get(vendorId) ?? 0) + ext,
      )
      if (!vendorNameMap.has(vendorId)) vendorNameMap.set(vendorId, vendorName)
    }

    caseAggMap.set(c.id, agg)
  }

  // 4. For every real vendor (off-contract is excluded by definition),
  // sum earned rebates from Rebate rows whose payPeriodEnd lands in
  // the window. We funnel through the canonical helper so the "earned"
  // filter logic stays in one place.
  const realVendorIds = Array.from(vendorSpendTotal.keys()).filter(
    (id) => id !== OFF_CONTRACT_VENDOR_KEY,
  )

  const vendorRebateMap = new Map<string, number>()

  if (realVendorIds.length > 0) {
    const rebateRows = await prisma.rebate.findMany({
      where: {
        facilityId: facility.id,
        contract: { vendorId: { in: realVendorIds } },
        payPeriodEnd: { gte: periodStart, lte: periodEnd },
      },
      select: {
        rebateEarned: true,
        payPeriodEnd: true,
        contract: { select: { vendorId: true } },
      },
    })

    // Bucket by vendor, then sum-through the canonical helper.
    const byVendor = new Map<
      string,
      Array<{ payPeriodEnd: Date; rebateEarned: unknown }>
    >()
    for (const r of rebateRows) {
      const vid = r.contract.vendorId
      const arr = byVendor.get(vid) ?? []
      arr.push({
        payPeriodEnd: r.payPeriodEnd,
        rebateEarned: r.rebateEarned,
      })
      byVendor.set(vid, arr)
    }

    for (const [vid, rows] of byVendor) {
      // Use periodEnd as `today` so any row with payPeriodEnd <=
      // periodEnd is treated as earned. The Prisma where clause
      // already constrained the lower bound.
      const earned = sumEarnedRebatesLifetime(
        rows.map((r) => ({
          payPeriodEnd: r.payPeriodEnd,
          rebateEarned: r.rebateEarned as number | string | null | undefined,
        })),
        periodEnd,
      )
      vendorRebateMap.set(vid, earned)
    }
  }

  // 5. Allocate per vendor using the canonical helper. Build
  // procedureId -> rebateAllocation rolled across all vendors.
  const procedureRebateAllocation = new Map<string, number>()

  for (const vendorId of vendorSpendTotal.keys()) {
    if (vendorId === OFF_CONTRACT_VENDOR_KEY) continue

    const totalVendorSpend = vendorSpendTotal.get(vendorId) ?? 0
    const totalRebate = vendorRebateMap.get(vendorId) ?? 0
    if (totalRebate <= 0 || totalVendorSpend <= 0) continue

    // Build the helper's `procedures` input: one row per case that
    // touched this vendor, keyed by case id (so we can fold back).
    const procRows: Array<{ procedureId: string; vendorSpend: number }> = []
    for (const agg of caseAggMap.values()) {
      const spend = agg.vendorSpend.get(vendorId) ?? 0
      if (spend > 0) procRows.push({ procedureId: agg.caseId, vendorSpend: spend })
    }

    const allocation = allocateRebatesToProcedures(
      procRows,
      totalVendorSpend,
      totalRebate,
    )

    for (const [procedureId, dollars] of allocation) {
      procedureRebateAllocation.set(
        procedureId,
        (procedureRebateAllocation.get(procedureId) ?? 0) + dollars,
      )
    }
  }

  // 6. Build per-procedure rows + summary roll-up.
  const procedures: TrueMarginProcedureRow[] = []
  let totalRevenue = 0
  let totalDirectCost = 0
  let totalRebateAllocation = 0

  for (const agg of caseAggMap.values()) {
    const rebate = procedureRebateAllocation.get(agg.caseId) ?? 0
    const effectiveCost = Math.max(0, agg.directCost - rebate)
    const standardMargin = agg.totalRevenue - agg.directCost
    const trueMargin = standardMargin + rebate
    const standardMarginPercent = pct(standardMargin, agg.totalRevenue)
    const trueMarginPercent = pct(trueMargin, agg.totalRevenue)
    const marginImprovementPercent =
      standardMarginPercent != null && trueMarginPercent != null
        ? trueMarginPercent - standardMarginPercent
        : null

    procedures.push({
      procedureId: agg.caseId,
      procedureName: agg.procedureName,
      caseNumber: agg.caseNumber,
      totalRevenue: agg.totalRevenue,
      directCost: agg.directCost,
      rebateAllocation: rebate,
      effectiveCost,
      standardMargin,
      trueMargin,
      standardMarginPercent,
      trueMarginPercent,
      marginImprovementPercent,
    })

    totalRevenue += agg.totalRevenue
    totalDirectCost += agg.directCost
    totalRebateAllocation += rebate
  }

  // Sort by trueMargin DESC so most-profitable rows surface first.
  procedures.sort((a, b) => b.trueMargin - a.trueMargin)

  const totalEffectiveCost = Math.max(0, totalDirectCost - totalRebateAllocation)
  const summaryStandardMargin = totalRevenue - totalDirectCost
  const summaryTrueMargin = summaryStandardMargin + totalRebateAllocation
  const summaryStandardPct = pct(summaryStandardMargin, totalRevenue)
  const summaryTruePct = pct(summaryTrueMargin, totalRevenue)
  const summaryImprovementPct =
    summaryStandardPct != null && summaryTruePct != null
      ? summaryTruePct - summaryStandardPct
      : null

  const vendors: TrueMarginVendorRow[] = Array.from(vendorSpendTotal.entries())
    .filter(([id]) => id !== OFF_CONTRACT_VENDOR_KEY)
    .map(([vendorId, spend]) => ({
      vendorId,
      vendorName: vendorNameMap.get(vendorId) ?? "Unknown vendor",
      totalSpend: spend,
      earnedRebate: vendorRebateMap.get(vendorId) ?? 0,
    }))
    .sort((a, b) => b.earnedRebate - a.earnedRebate)

  return serialize({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    summary: {
      totalRevenue,
      totalDirectCost,
      totalRebateAllocation,
      totalEffectiveCost,
      standardMargin: summaryStandardMargin,
      trueMargin: summaryTrueMargin,
      standardMarginPercent: summaryStandardPct,
      trueMarginPercent: summaryTruePct,
      marginImprovementPercent: summaryImprovementPct,
    },
    procedures,
    vendors,
  })
}
