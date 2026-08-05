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
import { toSafeResult, type SafeResult } from "@/lib/actions/safe-result"
import {
  canonicalizeCategoryName,
  UNCATEGORIZED_CATEGORY,
} from "@/lib/contracts/category-canonical"
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

/**
 * Optional scope for the analysis window. COG spend AND case/reimbursement
 * figures honor it — one time base for the whole page — with summed case
 * figures annualized before feeding the annual model.
 */
export interface AnalysisDataScope {
  /** ISO date. Omitted → 12 months before `end`. */
  start?: string
  /** ISO date. Omitted → now. */
  end?: string
  /**
   * Category names to include (canonicalized before matching). Omitted or
   * empty → every category. Rows with no category are the
   * `(uncategorized)` bucket, selectable like any other category.
   */
  categories?: string[]
}


export interface FacilityAnalysisData {
  currentVendorSpend: number
  /** Selected COG window (ISO strings) and its length in months. */
  windowStart: string
  windowEnd: string
  windowMonths: number
  /** Mean spend per month across the window. */
  avgMonthlySpend: number
  /**
   * Window spend scaled to a 12-month run rate — what the annual financial
   * model (EBITDA / DCF / impact) seeds from. Equals `currentVendorSpend`
   * on the default trailing-12-month window.
   */
  annualizedVendorSpend: number
  /** Every category with spend in the window, BEFORE the category filter —
   *  sorted by spend desc. Feeds the category picker. */
  availableCategories: string[]
  netRevenue: number
  /** True when netRevenue was implied from spend (no case reimbursement). */
  revenueIsImplied: boolean
  /**
   * Case-costing reimbursement summed over the WINDOW and annualized (the
   * "Actuals" annual revenue candidate). Reported even when implausibly
   * low — the Net Revenue control offers it transparently with a coverage
   * caveat rather than silently substituting the spend-based proxy.
   */
  measuredReimbursement: number
  /** Reimbursement coverage: cases with a non-zero payor rate vs total,
   *  RAW window counts (not annualized). */
  reimbursementCoverage: { withRate: number; totalCases: number }
  /** Mean reimbursement per covered case — raw window ratio, immune to the
   *  annualization applied to the summed figures. */
  avgCoveredCaseReimbursement: number
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

const MS_PER_MONTH = (365.25 / 12) * 24 * 60 * 60 * 1000

function parseScopeDate(value: string | undefined, label: string): Date | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label} date for analysis window`)
  }
  return d
}

export async function getFacilityAnalysisData(
  scope?: AnalysisDataScope,
): Promise<FacilityAnalysisData> {
  const { facility } = await requireFacility()

  // Resolve the window: explicit bounds when given, else the canonical
  // trailing-12. A lone bound gets the other defaulted relative to it.
  const scopeEnd = parseScopeDate(scope?.end, "end")
  const scopeStart = parseScopeDate(scope?.start, "start")
  let windowStart: Date
  let windowEnd: Date
  if (scopeStart || scopeEnd) {
    windowEnd = scopeEnd ?? new Date()
    if (scopeStart) {
      windowStart = scopeStart
    } else {
      windowStart = new Date(windowEnd)
      windowStart.setMonth(windowStart.getMonth() - 12)
    }
    if (windowStart.getTime() > windowEnd.getTime()) {
      throw new Error("Analysis window start must be before its end")
    }
  } else {
    ;({ start: windowStart, end: windowEnd } = getTrailing12MonthWindow())
  }

  // Category filter — canonicalized on both sides (never raw equality).
  // The uncategorized sentinel passes through untouched — canonicalization
  // would strip its parentheses and it must round-trip picker → filter.
  const selectedCategories = (scope?.categories ?? [])
    .map((c) =>
      c === UNCATEGORIZED_CATEGORY ? c : canonicalizeCategoryName(c),
    )
    .filter(Boolean)
  const selectedSet =
    selectedCategories.length > 0 ? new Set(selectedCategories) : null

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
      // Cases honor the SAME window as COG spend (review 2026-08-05: they
      // were facility-lifetime, so a 3-month window mixed time bases —
      // 3 months of spend against all-time reimbursement and volume).
      where: {
        facilityId: facility.id,
        dateOfSurgery: { gte: windowStart, lte: windowEnd },
      },
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
  // Window spend BEFORE the category filter — the facility-wide base the
  // revenue proxy and its plausibility gate compare against, so narrowing
  // the category selection never redefines the facility's top line.
  let unfilteredWindowSpend = 0
  const categoryAgg = new Map<string, { spend: number; qty: number }>()
  const vendorAgg = new Map<string, { name: string; spend: number }>()
  // Pre-filter spend per category, so the picker can list every category in
  // the window even while a subset is selected.
  const availableAgg = new Map<string, number>()

  for (const r of cogRows) {
    const spend = Number(r.extendedPrice ?? 0)
    // Rows without a category land in the first-class `(uncategorized)`
    // bucket, so shares always sum to the headline spend. The `||` also
    // routes categories that CANONICALIZE to nothing ("-", "&", "The") into
    // the bucket — a bare "" bucket would render a blank picker row whose
    // selection the server then silently drops (review 2026-08-05).
    const bucket =
      (r.category ? canonicalizeCategoryName(r.category) : "") ||
      UNCATEGORIZED_CATEGORY

    availableAgg.set(bucket, (availableAgg.get(bucket) ?? 0) + spend)
    unfilteredWindowSpend += spend

    // With a category filter active, only rows in the selected categories
    // count — including toward the spend total, so the headline figure is
    // the spend of exactly what the user chose.
    if (selectedSet && !selectedSet.has(bucket)) {
      continue
    }

    totalSpend += spend

    const cur = categoryAgg.get(bucket) ?? { spend: 0, qty: 0 }
    cur.spend += spend
    cur.qty += r.quantity ?? 0
    categoryAgg.set(bucket, cur)

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

  // ── Window length + annualization ──────────────────────────────
  // The canonical trailing-12 window is exactly 12 months by construction —
  // snap it so `annualizedVendorSpend === currentVendorSpend` there instead of
  // drifting ~0.1% off through the ms→month conversion.
  const isDefaultWindow = !scopeStart && !scopeEnd
  const windowMonths = isDefaultWindow
    ? 12
    : Math.max(
        1 / 30, // never divide by zero on a degenerate same-day window
        (windowEnd.getTime() - windowStart.getTime()) / MS_PER_MONTH,
      )
  const avgMonthlySpend = totalSpend / windowMonths
  const annualizedVendorSpend = avgMonthlySpend * 12
  const annualizedUnfilteredSpend = (unfilteredWindowSpend / windowMonths) * 12

  // ── Net revenue + case volume + margin (all cases) ─────────────
  const cptRateSchedule = buildCptRateSchedule(payorContracts)
  let sumReimbursement = 0
  let sumCaseSpend = 0
  let casesWithRate = 0
  for (const c of cases) {
    const caseReimbursement = resolveCaseReimbursement(
      {
        storedReimbursement: Number(c.totalReimbursement),
        primaryCptCode: c.primaryCptCode,
        procedureCptCodes: c.procedures.map((p) => p.cptCode),
      },
      cptRateSchedule,
      c.dateOfSurgery,
    )
    sumReimbursement += caseReimbursement
    if (caseReimbursement > 0) casesWithRate += 1
    sumCaseSpend += Number(c.totalSpend)
  }

  // Net revenue must exceed total supply spend. Measured case reimbursement only
  // covers cases whose CPT is in a loaded payor contract (often a small subset),
  // so it routinely understates revenue — e.g. $3.5M "revenue" against $23.7M of
  // COG spend, which is impossible and made EBITDA/DCF look wrong (Vick
  // 2026-06-21). Treat revenue as IMPLIED whenever the measured figure is
  // missing OR implausibly low (≤ supply spend), falling back to the
  // spend-based proxy (spend ÷ supply-cost-%) so EBITDA/DCF stay coherent.
  //
  // Cases are window-scoped now, so the summed reimbursement is annualized
  // by the same factor as spend before feeding the annual model — both
  // sides of every comparison share one time base. The factor is exactly 1
  // on the default trailing-12 window.
  const annualizeFactor = 12 / windowMonths
  const annualizedReimbursement = sumReimbursement * annualizeFactor

  // Both the gate and the proxy compare against the ANNUALIZED, UNFILTERED
  // window spend (review 2026-08-05): net revenue is the facility's annual
  // top line, and the model is annual. Comparing an unlike-based
  // reimbursement figure to a 3-month or single-category spend slice
  // flipped the gate to "actuals" and rendered spend > revenue — the exact
  // incoherence this gate exists to prevent. On the default window with no
  // filter this is byte-identical to the old `totalSpend` comparison.
  const revenueIsImplied = annualizedReimbursement <= annualizedUnfilteredSpend
  const netRevenue = revenueIsImplied
    ? annualizedUnfilteredSpend / IMPLIED_SUPPLY_COST_PCT
    : annualizedReimbursement

  // Only trust a measured margin when revenue is coherent (not implied) — a
  // partial reimbursement total would otherwise yield a garbage margin.
  // (A ratio of same-window sums — no annualization needed.)
  const avgMarginPct = !revenueIsImplied
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

  const availableCategories = [...availableAgg.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category]) => category)

  return serialize({
    currentVendorSpend: totalSpend,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    windowMonths,
    avgMonthlySpend,
    annualizedVendorSpend,
    availableCategories,
    netRevenue,
    revenueIsImplied,
    // Annualized — this figure IS the "Actuals" annual revenue candidate.
    measuredReimbursement: annualizedReimbursement,
    reimbursementCoverage: { withRate: casesWithRate, totalCases: cases.length },
    avgCoveredCaseReimbursement:
      casesWithRate > 0 ? sumReimbursement / casesWithRate : 0,
    // Never round REAL cases down to zero: on a >24-month window one case
    // would round to 0 and collapse manual-mode revenue (rate × 0).
    annualCaseVolume:
      cases.length > 0
        ? Math.max(1, Math.round(cases.length * annualizeFactor))
        : 0,
    avgMarginPct,
    categories,
    vendors,
    topVendorConcentrationPct,
    hasData: cogRows.length > 0,
  })
}

/**
 * Error-as-value variant for client-triggered scope refetches — Next 16 prod
 * builds redact thrown Server Action errors, so the range-picker toast would
 * otherwise show a useless digest message (see lib/actions/safe-result.ts).
 */
export async function getFacilityAnalysisDataSafe(
  scope?: AnalysisDataScope,
): Promise<SafeResult<FacilityAnalysisData>> {
  return toSafeResult("getFacilityAnalysisData", { scope }, () =>
    getFacilityAnalysisData(scope),
  )
}
