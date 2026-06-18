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
import {
  buildCptRateSchedule,
  resolveCaseReimbursement,
} from "@/lib/case-costing/cpt-rate-map"
import { buildSupplyRebateRuleMap } from "@/lib/actions/case-costing/supply-rebate-rules"
import { applySupplyRebateRule } from "@/lib/case-costing/attribute-surgeon-rebates"

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

  // 1. Load cases + supplies in the window, plus the facility's active
  // payor contracts so we can backfill reimbursement (Revenue) from the
  // canonical CPT-rate map when `Case.totalReimbursement` is 0 (the prod
  // demo state). Same helper as the cases list / hero card / report —
  // see CLAUDE.md "Case reimbursement backfill" invariant. Without this,
  // the Revenue column reads raw stored reimbursement and shows $0.
  const [cases, payorContracts] = await Promise.all([
    prisma.case.findMany({
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
            // quantity drives per-unit (volume) rebate rules.
            quantity: true,
          },
        },
        procedures: {
          select: { cptCode: true },
        },
      },
      orderBy: { dateOfSurgery: "asc" },
    }),
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  const cptRateSchedule = buildCptRateSchedule(payorContracts)

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
    /** Per-supply contributed rebate, summed across the case's supplies. */
    rebate: number
    /** vendorId -> dollars */
    vendorSpend: Map<string, number>
  }

  // 3a. Per-supply rebate rule per contract — the SAME derivation the
  // surgeon Rebate-Contribution report uses (CLAUDE.md "Per-supply rebate
  // rule"). This is what makes the Rebate Allocation column reflect the
  // actual products used on each case, matched to their contract's rebate
  // terms — rather than spreading each vendor's earned rebate by spend
  // share. Vick 2026-06-16.
  const ruleByContract = await buildSupplyRebateRuleMap(
    facility.id,
    Array.from(contractIds),
  )

  const caseAggMap = new Map<string, CaseAggregate>()
  const vendorSpendTotal = new Map<string, number>()
  const vendorNameMap = new Map<string, string>()
  // vendorId -> Σ per-supply contributed rebate (drives the vendor roll-up,
  // kept coherent with the per-procedure allocation — same numbers).
  const vendorRebateMap = new Map<string, number>()

  for (const c of cases) {
    const agg: CaseAggregate = {
      caseId: c.id,
      caseNumber: c.caseNumber,
      procedureName: c.primaryCptCode
        ? `${c.primaryCptCode} — ${c.surgeonName ?? "Unknown"}`
        : `Case ${c.caseNumber}`,
      totalRevenue: resolveCaseReimbursement(
        {
          storedReimbursement: Number(c.totalReimbursement),
          primaryCptCode: c.primaryCptCode,
          procedureCptCodes: c.procedures.map((p) => p.cptCode),
        },
        cptRateSchedule,
        c.dateOfSurgery,
      ),
      directCost: Number(c.totalSpend),
      rebate: 0,
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

      // Per-supply contributed rebate: match the product to its contract
      // and apply that contract's rebate rule. Only ON-contract supplies
      // tied to a contract can contribute; the rule's ≤extendedCost clamp
      // lives in applySupplyRebateRule.
      if (s.isOnContract && s.contractId) {
        const rule = ruleByContract.get(s.contractId) ?? { kind: "none" }
        const supplyRebate = applySupplyRebateRule(rule, {
          extendedCost: ext,
          quantity: Number(s.quantity),
        })
        if (supplyRebate > 0) {
          agg.rebate += supplyRebate
          if (vendorId !== OFF_CONTRACT_VENDOR_KEY) {
            vendorRebateMap.set(
              vendorId,
              (vendorRebateMap.get(vendorId) ?? 0) + supplyRebate,
            )
          }
        }
      }
    }

    caseAggMap.set(c.id, agg)
  }

  // 4. Per-procedure rebate allocation = the case's summed per-supply
  // contributed rebate (computed above).
  const procedureRebateAllocation = new Map<string, number>()
  for (const agg of caseAggMap.values()) {
    procedureRebateAllocation.set(agg.caseId, agg.rebate)
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
