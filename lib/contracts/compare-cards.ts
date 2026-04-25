/**
 * Contract compare-view data builders — pure functions that turn an already
 * loaded contract (+ optional metrics) into the 5 card shapes rendered by
 * the side-by-side comparison view.
 *
 * Spec: docs/superpowers/specs/2026-04-18-contracts-list-closure.md
 * subsystem 4 — the 5-card comparison UI.
 *
 * No Prisma, no I/O, no formatting dependencies. Callers load contracts and
 * pass them in. Numeric currency values stay as raw numbers; the presentation
 * layer decides locale/formatting for the numeric fields. Only string rows
 * (Overview / Rebate terms labels) carry pre-formatted text because those
 * are mixed-type display rows.
 */

import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface ContractForCompare {
  id: string
  name: string
  vendor: { id: string; name: string }
  contractType: string
  status: string
  effectiveDate: Date
  expirationDate: Date
  totalValue: number
  facilities: Array<{ id: string; name: string }>
  terms: Array<{
    id: string
    termName: string
    termType: string
    tiers: Array<{
      tierNumber: number
      tierName?: string | null
      spendMin: number
      spendMax: number | null
      rebateValue: number
    }>
  }>
  pricingItems: Array<{
    vendorItemNo: string
    description: string | null
    category: string | null
    unitPrice: number
  }>
  /** Populated by getContractMetricsBatch. */
  metrics?: {
    spend: number
    rebate: number
    rebateCollected: number
  }
  score?: number | null
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DAYS_PER_MONTH = 30

function formatCurrency(value: number): string {
  // Keep US-locale with no fractional digits. Presentation layer can reformat
  // if needed — Overview rows just need a stable human string.
  return `$${Math.round(value).toLocaleString("en-US")}`
}

function formatDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  const d = String(date.getUTCDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function safeDivide(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0
  return numerator / denominator
}

// ---------------------------------------------------------------------------
// Card 1 — Contract Overview
// ---------------------------------------------------------------------------

export interface OverviewCard {
  rows: Array<{ label: string; value: string }>
}

export function buildOverviewCard(contract: ContractForCompare): OverviewCard {
  const rebatesEarned = contract.metrics?.rebate ?? 0
  const scoreLabel =
    contract.score === null || contract.score === undefined
      ? "—"
      : `${Math.round(contract.score)}`

  return {
    rows: [
      { label: "Vendor", value: contract.vendor.name },
      { label: "Type", value: contract.contractType },
      { label: "Status", value: contract.status },
      { label: "Effective", value: formatDate(contract.effectiveDate) },
      { label: "Expiration", value: formatDate(contract.expirationDate) },
      { label: "Total Value", value: formatCurrency(contract.totalValue) },
      { label: "Rebates Earned", value: formatCurrency(rebatesEarned) },
      { label: "Score", value: scoreLabel },
      { label: "Facility Count", value: `${contract.facilities.length}` },
    ],
  }
}

// ---------------------------------------------------------------------------
// Card 2 — Rebate Terms
// ---------------------------------------------------------------------------

export interface RebateTermsCard {
  terms: Array<{
    termName: string
    termType: string
    tiers: Array<{
      label: string
      rateLabel: string
      thresholdDollar: string
    }>
  }>
  isEmpty: boolean
}

function tierLabel(tier: ContractForCompare["terms"][number]["tiers"][number]): string {
  const trimmed = tier.tierName?.trim()
  if (trimmed) return trimmed
  return `Tier ${tier.tierNumber}`
}

function tierThresholdDollar(
  tier: ContractForCompare["terms"][number]["tiers"][number],
): string {
  if (tier.spendMax !== null && tier.spendMax !== undefined) {
    return `${formatCurrency(tier.spendMin)}–${formatCurrency(tier.spendMax)}`
  }
  return `${formatCurrency(tier.spendMin)}+`
}

function tierRateLabel(
  tier: ContractForCompare["terms"][number]["tiers"][number],
  termType: string,
): string {
  const isPercent = termType.toLowerCase().includes("percent")
  // Charles 2026-04-25: route through the canonical scaler so tiers
  // stored as fractions (0.03) render as percent labels (3%) rather
  // than fraction labels (0.03%). See
  // `docs/architecture/recurring-bug-patterns.md` family 1.
  const rate = isPercent
    ? `${toDisplayRebateValue("percent_of_spend", tier.rebateValue).toFixed(1)}%`
    : formatCurrency(tier.rebateValue)
  const threshold = `${formatCurrency(tier.spendMin)}`
  return `${rate} on spend ≥ ${threshold}`
}

export function buildRebateTermsCard(
  contract: ContractForCompare,
): RebateTermsCard {
  if (contract.terms.length === 0) {
    return { terms: [], isEmpty: true }
  }
  const terms = contract.terms.map((term) => ({
    termName: term.termName,
    termType: term.termType,
    tiers: term.tiers
      .slice()
      .sort((a, b) => a.tierNumber - b.tierNumber)
      .map((tier) => ({
        label: tierLabel(tier),
        rateLabel: tierRateLabel(tier, term.termType),
        thresholdDollar: tierThresholdDollar(tier),
      })),
  }))
  return { terms, isEmpty: false }
}

// ---------------------------------------------------------------------------
// Card 3 — Financial Performance
// ---------------------------------------------------------------------------

export interface FinancialPerformanceCard {
  totalSpend: number
  rebatesEarned: number
  rebatesCollected: number
  outstanding: number
  effectiveRebateRate: number
  color: "green" | "amber" | "red"
}

function rateColor(ratePct: number): "green" | "amber" | "red" {
  if (ratePct >= 3) return "green"
  if (ratePct >= 1.5) return "amber"
  return "red"
}

export function buildFinancialCard(
  contract: ContractForCompare,
): FinancialPerformanceCard {
  const totalSpend = contract.metrics?.spend ?? 0
  const rebatesEarned = contract.metrics?.rebate ?? 0
  const rebatesCollected = contract.metrics?.rebateCollected ?? 0
  const outstanding = rebatesEarned - rebatesCollected
  const effectiveRebateRate = safeDivide(rebatesEarned, totalSpend) * 100

  return {
    totalSpend,
    rebatesEarned,
    rebatesCollected,
    outstanding,
    effectiveRebateRate,
    color: rateColor(effectiveRebateRate),
  }
}

// ---------------------------------------------------------------------------
// Card 4 — Pricing Items
// ---------------------------------------------------------------------------

export interface PricingItemsCard {
  itemCount: number
  categoriesCount: number
  avgUnitPrice: number
  topCategories: string[]
  remainingCount: number
}

export function buildPricingItemsCard(
  contract: ContractForCompare,
): PricingItemsCard {
  const items = contract.pricingItems
  const itemCount = items.length

  const counts = new Map<string, number>()
  for (const item of items) {
    const key = item.category?.trim() || "Uncategorized"
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const categoriesCount = counts.size

  const sorted = [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })
  const topCategories = sorted.slice(0, 3).map(([name]) => name)
  const remainingCount = Math.max(0, categoriesCount - topCategories.length)

  const priceSum = items.reduce((sum, item) => sum + (item.unitPrice ?? 0), 0)
  const avgUnitPrice = itemCount > 0 ? priceSum / itemCount : 0

  return {
    itemCount,
    categoriesCount,
    avgUnitPrice,
    topCategories,
    remainingCount,
  }
}

// ---------------------------------------------------------------------------
// Card 5 — Contract Terms
// ---------------------------------------------------------------------------

export interface ContractTermsCard {
  durationMonths: number
  daysRemaining: number
  daysRemainingColor: "green" | "amber" | "red"
  autoRenewal: boolean
  scope: "facility" | "multi_facility" | "group"
  expiringSoon: boolean
}

function daysRemainingColor(days: number): "green" | "amber" | "red" {
  if (days < 0) return "red"
  if (days < 30) return "red"
  if (days < 90) return "amber"
  return "green"
}

function facilityScope(count: number): ContractTermsCard["scope"] {
  if (count <= 1) return "facility"
  if (count <= 5) return "multi_facility"
  return "group"
}

export function buildContractTermsCard(
  contract: ContractForCompare,
  options?: { referenceDate?: Date },
): ContractTermsCard {
  const reference = options?.referenceDate ?? new Date()

  const durationMs =
    contract.expirationDate.getTime() - contract.effectiveDate.getTime()
  const durationMonths = Math.max(
    0,
    Math.round(durationMs / MS_PER_DAY / DAYS_PER_MONTH),
  )

  const remainingMs = contract.expirationDate.getTime() - reference.getTime()
  const daysRemaining = Math.round(remainingMs / MS_PER_DAY)

  const expiringSoon = daysRemaining > 0 && daysRemaining < 180
  const scope = facilityScope(contract.facilities.length)

  return {
    durationMonths,
    daysRemaining,
    daysRemainingColor: daysRemainingColor(daysRemaining),
    // Placeholder — contracts don't currently expose an auto-renewal flag.
    autoRenewal: false,
    scope,
    expiringSoon,
  }
}
