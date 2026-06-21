/**
 * Turn an uploaded pricing/spend file into the `FacilityAnalysisData` shape the
 * Current State dashboard models on — so a facility can run the CFO analysis
 * against contract/pricing data they upload, not just live COG (Vick 2026-06-21).
 *
 * Pure. The UI projects parsed rows (+ the column mapping) into
 * `UploadedSpendLine[]`; this aggregates them into category/vendor breakdowns
 * with the same shares/ASP shape `getFacilityAnalysisData` produces, so the
 * deterministic model + AI layer work identically on uploaded data.
 *
 * Spend per line = explicit `spend` (extended/total) when present, else
 * `unitPrice × (quantity ?? 1)`. Revenue is implied from spend (a pricing file
 * has no revenue), consistent with the live-COG path.
 */

import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import type {
  FacilityAnalysisData,
  AnalysisCategoryRow,
  AnalysisVendorRow,
} from "@/lib/actions/facility-analysis-data"

export interface UploadedSpendLine {
  category?: string | null
  vendor?: string | null
  unitPrice?: number | null
  quantity?: number | null
  /** Explicit extended/total spend, if the file has it. */
  spend?: number | null
}

const IMPLIED_SUPPLY_COST_PCT = 0.3
const DEFAULT_MARGIN_PCT = 0.7

function lineSpend(l: UploadedSpendLine): number {
  if (l.spend != null && Number.isFinite(l.spend) && l.spend > 0) return l.spend
  const price = l.unitPrice ?? 0
  const qty = l.quantity ?? 1
  const s = price * qty
  return Number.isFinite(s) && s > 0 ? s : 0
}

export function aggregateUploadedSpend(
  lines: UploadedSpendLine[],
): FacilityAnalysisData {
  let totalSpend = 0
  const categoryAgg = new Map<string, { spend: number; qty: number }>()
  const vendorAgg = new Map<string, { name: string; spend: number }>()

  for (const l of lines) {
    const spend = lineSpend(l)
    if (spend <= 0) continue
    totalSpend += spend
    const qty = l.quantity != null && l.quantity > 0 ? l.quantity : 1

    if (l.category && l.category.trim()) {
      const key = canonicalizeCategoryName(l.category)
      const cur = categoryAgg.get(key) ?? { spend: 0, qty: 0 }
      cur.spend += spend
      cur.qty += qty
      categoryAgg.set(key, cur)
    }
    if (l.vendor && l.vendor.trim()) {
      const key = l.vendor.trim().toLowerCase()
      const cur = vendorAgg.get(key) ?? { name: l.vendor.trim(), spend: 0 }
      cur.spend += spend
      vendorAgg.set(key, cur)
    }
  }

  const totalCategorizedSpend =
    [...categoryAgg.values()].reduce((s, c) => s + c.spend, 0) || 1
  const totalQty =
    [...categoryAgg.values()].reduce((s, c) => s + c.qty, 0) || 1
  const totalVendorSpend =
    [...vendorAgg.values()].reduce((s, v) => s + v.spend, 0) || 1

  const categories: AnalysisCategoryRow[] = [...categoryAgg.entries()]
    .map(([category, c]) => ({
      category,
      spendShare: c.spend / totalCategorizedSpend,
      asp: c.qty > 0 ? c.spend / c.qty : 0,
      volumeShare: c.qty / totalQty,
      marginPct: DEFAULT_MARGIN_PCT,
    }))
    .sort((a, b) => b.spendShare - a.spendShare)

  const vendors: AnalysisVendorRow[] = [...vendorAgg.values()]
    .map((v) => ({ vendor: v.name, spendShare: v.spend / totalVendorSpend }))
    .sort((a, b) => b.spendShare - a.spendShare)

  return {
    currentVendorSpend: totalSpend,
    netRevenue: totalSpend / IMPLIED_SUPPLY_COST_PCT,
    revenueIsImplied: true,
    annualCaseVolume: 0,
    avgMarginPct: DEFAULT_MARGIN_PCT,
    categories,
    vendors,
    topVendorConcentrationPct: vendors[0]?.spendShare ?? 0,
    hasData: totalSpend > 0,
  }
}
