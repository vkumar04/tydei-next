"use server"

/**
 * Facility Analysis dashboard — real DB data loader.
 *
 * Pulls every MEASURABLE input for the CFO dashboard from the facility's own
 * data (trailing-12-month COG for spend / category / vendor breakdowns;
 * all-cases reimbursement for net revenue, case volume, and contribution
 * margin). The non-measurable financial knobs (EBITDA margin, DCF %, discount,
 * growth, EV multiples) stay as slider assumptions — a facility "will never
 * know fixed and variable costs" (Charles).
 *
 * Returns category / vendor breakdowns as SHARES (of total spend), not
 * absolute dollars, so the dashboard's spend slider re-flows every table
 * while the initial values still match the DB exactly. A `revenue-implied`
 * proxy backfills net revenue when no case reimbursement is available
 * (netRevenue ≈ vendorSpend ÷ supply-cost-%), which is also how the screenshot
 * $12.5M spend → $41.7M revenue relationship arises.
 */

import { requireFacility } from "@/lib/actions/auth"
import { getTrailing12MonthWindow } from "@/lib/dates/trailing-window"
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import {
  buildCptRateSchedule,
  resolveCaseReimbursement,
} from "@/lib/case-costing/cpt-rate-map"

export interface AnalysisCategoryRow {
  category: string
  /** Share of total categorized COG spend (0–1). */
  spendShare: number
  /** Average selling price = spend ÷ quantity. */
  asp: number
  /** Share of total quantity (0–1) — a volume proxy. */
  volumeShare: number
  /** Contribution margin %, fraction (facility average; per-category n/a). */
  marginPct: number
}

export interface AnalysisVendorRow {
  vendor: string
  /** Share of total vendor-attributed COG spend (0–1). */
  spendShare: number
}

export interface FacilityAnalysisData {
  currentVendorSpend: number
  netRevenue: number
  /** True when netRevenue was implied from spend (no case reimbursement). */
  revenueIsImplied: boolean
  annualCaseVolume: number
  /** Facility average contribution-margin %, fraction. */
  avgMarginPct: number
  categories: AnalysisCategoryRow[]
  vendors: AnalysisVendorRow[]
  /** Top-vendor share of spend (0–1) — Vendor Concentration Risk input. */
  topVendorConcentrationPct: number
  /** False when the facility has no COG yet (caller falls back to seed). */
  hasData: boolean
}

/** Supply cost as a share of revenue used for the revenue-implied proxy. */
const IMPLIED_SUPPLY_COST_PCT = 0.3
const DEFAULT_MARGIN_PCT = 0.7

export async function getFacilityAnalysisData(): Promise<FacilityAnalysisData> {
  const { facility } = await requireFacility()

  const { start: windowStart, end: windowEnd } = getTrailing12MonthWindow()

  const [cogRows, cases, payorContracts] = await Promise.all([
    prisma.cOGRecord.findMany({
      where: {
        facilityId: facility.id,
        transactionDate: { gte: windowStart, lte: windowEnd },
      },
      select: {
        category: true,
        quantity: true,
        extendedPrice: true,
        vendorId: true,
        vendor: { select: { name: true, displayName: true } },
      },
    }),
    prisma.case.findMany({
      where: { facilityId: facility.id },
      select: {
        totalSpend: true,
        totalReimbursement: true,
        primaryCptCode: true,
        dateOfSurgery: true,
        procedures: { select: { cptCode: true } },
      },
    }),
    prisma.payorContract.findMany({
      where: { facilityId: facility.id, status: "active" },
      select: { cptRates: true },
    }),
  ])

  // ── Spend totals + category / vendor breakdowns ────────────────
  let totalSpend = 0
  const categoryAgg = new Map<string, { spend: number; qty: number }>()
  const vendorAgg = new Map<string, { name: string; spend: number }>()

  for (const r of cogRows) {
    const spend = Number(r.extendedPrice ?? 0)
    totalSpend += spend

    if (r.category) {
      const key = canonicalizeCategoryName(r.category)
      const cur = categoryAgg.get(key) ?? { spend: 0, qty: 0 }
      cur.spend += spend
      cur.qty += r.quantity ?? 0
      categoryAgg.set(key, cur)
    }

    if (r.vendorId) {
      const name = r.vendor?.displayName ?? r.vendor?.name ?? "Unknown vendor"
      const cur = vendorAgg.get(r.vendorId) ?? { name, spend: 0 }
      cur.spend += spend
      vendorAgg.set(r.vendorId, cur)
    }
  }

  const totalCategorizedSpend =
    [...categoryAgg.values()].reduce((s, c) => s + c.spend, 0) || 1
  const totalQty =
    [...categoryAgg.values()].reduce((s, c) => s + c.qty, 0) || 1
  const totalVendorSpend =
    [...vendorAgg.values()].reduce((s, v) => s + v.spend, 0) || 1

  // ── Net revenue + case volume + margin (all cases) ─────────────
  const cptRateSchedule = buildCptRateSchedule(payorContracts)
  let sumReimbursement = 0
  let sumCaseSpend = 0
  for (const c of cases) {
    sumReimbursement += resolveCaseReimbursement(
      {
        storedReimbursement: Number(c.totalReimbursement),
        primaryCptCode: c.primaryCptCode,
        procedureCptCodes: c.procedures.map((p) => p.cptCode),
      },
      cptRateSchedule,
      c.dateOfSurgery,
    )
    sumCaseSpend += Number(c.totalSpend)
  }

  const revenueIsImplied = sumReimbursement <= 0
  const netRevenue = revenueIsImplied
    ? totalSpend / IMPLIED_SUPPLY_COST_PCT
    : sumReimbursement

  const avgMarginPct =
    sumReimbursement > 0
      ? Math.max(0, (sumReimbursement - sumCaseSpend) / sumReimbursement)
      : DEFAULT_MARGIN_PCT

  // ── Shape rows (sorted desc by spend) ──────────────────────────
  const categories: AnalysisCategoryRow[] = [...categoryAgg.entries()]
    .map(([category, c]) => ({
      category,
      spendShare: c.spend / totalCategorizedSpend,
      asp: c.qty > 0 ? c.spend / c.qty : 0,
      volumeShare: c.qty / totalQty,
      marginPct: avgMarginPct,
    }))
    .sort((a, b) => b.spendShare - a.spendShare)

  const vendors: AnalysisVendorRow[] = [...vendorAgg.values()]
    .map((v) => ({ vendor: v.name, spendShare: v.spend / totalVendorSpend }))
    .sort((a, b) => b.spendShare - a.spendShare)

  const topVendorConcentrationPct = vendors[0]?.spendShare ?? 0

  return serialize({
    currentVendorSpend: totalSpend,
    netRevenue,
    revenueIsImplied,
    annualCaseVolume: cases.length,
    avgMarginPct,
    categories,
    vendors,
    topVendorConcentrationPct,
    hasData: cogRows.length > 0,
  })
}
