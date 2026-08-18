/**
 * Matches proposed pricing against a contract's existing pricing, so a vendor's
 * price list can be read as "add these, reprice those" instead of an opaque
 * replacement.
 *
 * The ONE owner of that classification. SKUs are matched on `normalizeSku` and
 * categories on `canonicalizeCategoryName`, never raw `===` — both are
 * case-sensitive and under-count (CLAUDE.md).
 *
 * Directive-free and Prisma-free: the vendor proposes with it client-side and
 * the facility applies with it server-side, off the same result.
 */

import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"

export interface ProposedPricingItem {
  vendorItemNo: string
  description?: string
  category?: string
  unitPrice: number
  uom?: string
}

/** The subset of a ContractPricing row the match needs. */
export interface ExistingPricingRow {
  id: string
  vendorItemNo: string
  description?: string | null
  category?: string | null
  unitPrice: number | string | { toString(): string }
}

export type PricingChangeKind = "add" | "update" | "unchanged"

export interface PricingChange {
  kind: PricingChangeKind
  item: ProposedPricingItem
  /** The matched row, when one exists. */
  existingId: string | null
  /** Current contract price; null for an add. */
  oldPrice: number | null
  /** `unitPrice − oldPrice`; null for an add. */
  delta: number | null
  /** Fractional change vs the old price; null for an add or a zero old price. */
  deltaPercent: number | null
  /** Set when the SKU matches but the category disagrees — the reviewer decides. */
  categoryConflict: { existing: string; proposed: string } | null
}

export interface PricingMatchResult {
  changes: PricingChange[]
  added: PricingChange[]
  updated: PricingChange[]
  unchanged: PricingChange[]
  /** Proposed rows sharing a normalized SKU — the last one would silently win. */
  duplicateSkus: string[]
}

/** Prices are money; compare at cent precision, not float identity. */
const cents = (n: number) => Math.round(n * 100)

export function matchProposedPricing(
  proposed: ProposedPricingItem[],
  existing: ExistingPricingRow[],
): PricingMatchResult {
  const bySku = new Map<string, ExistingPricingRow>()
  for (const row of existing) {
    const key = normalizeSku(row.vendorItemNo)
    if (key) bySku.set(key, row)
  }

  const seen = new Set<string>()
  const duplicateSkus: string[] = []
  const changes: PricingChange[] = []

  for (const item of proposed) {
    const key = normalizeSku(item.vendorItemNo)
    if (key) {
      if (seen.has(key) && !duplicateSkus.includes(item.vendorItemNo)) {
        duplicateSkus.push(item.vendorItemNo)
      }
      seen.add(key)
    }

    const match = key ? bySku.get(key) : undefined
    if (!match) {
      changes.push({
        kind: "add",
        item,
        existingId: null,
        oldPrice: null,
        delta: null,
        deltaPercent: null,
        categoryConflict: null,
      })
      continue
    }

    const oldPrice = Number(match.unitPrice)
    const same = cents(oldPrice) === cents(item.unitPrice)
    const existingCat = canonicalizeCategoryName(match.category ?? "")
    const proposedCat = canonicalizeCategoryName(item.category ?? "")
    const categoryConflict =
      proposedCat && existingCat && proposedCat !== existingCat
        ? { existing: match.category ?? "", proposed: item.category ?? "" }
        : null

    changes.push({
      kind: same ? "unchanged" : "update",
      item,
      existingId: match.id,
      oldPrice,
      delta: same ? 0 : item.unitPrice - oldPrice,
      deltaPercent: same || oldPrice === 0 ? null : (item.unitPrice - oldPrice) / oldPrice,
      categoryConflict,
    })
  }

  return {
    changes,
    added: changes.filter((c) => c.kind === "add"),
    updated: changes.filter((c) => c.kind === "update"),
    unchanged: changes.filter((c) => c.kind === "unchanged"),
    duplicateSkus,
  }
}

/** Headline for the reviewer: "+12 new · 3 repriced · 5 unchanged". */
export function summarizePricingMatch(result: PricingMatchResult): string {
  const parts: string[] = []
  if (result.added.length) parts.push(`${result.added.length} new`)
  if (result.updated.length) parts.push(`${result.updated.length} repriced`)
  if (result.unchanged.length) parts.push(`${result.unchanged.length} unchanged`)
  return parts.length ? parts.join(" · ") : "No pricing items"
}
